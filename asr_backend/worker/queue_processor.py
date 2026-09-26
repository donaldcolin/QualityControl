import os
import uuid
import json
import logging
import requests
from pathlib import Path
from dotenv import load_dotenv

from supabase import create_client, Client

import asr.asr_pipeline as pipeline
import coaching.coaching_agent as qc_agent
import translation.translator as translator
import worker.pii_scrubber as pii_scrubber

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logger = logging.getLogger("worker")

load_dotenv()

supabase_url = os.environ.get("SUPABASE_URL", "")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
if supabase_url and supabase_key:
    supabase: Client = create_client(supabase_url, supabase_key)
else:
    logger.warning("SUPABASE_URL and SUPABASE_KEY not set in environment.")
    supabase = None

def process_queue_item(queue_id: str):
    if not supabase:
        logger.error("Supabase client not initialized.")
        return
        
    try:
        # Fetch queue item
        resp = supabase.table("callizer_queue").select("*").eq("id", queue_id).execute()
        if not resp.data:
            logger.warning(f"Queue item {queue_id} not found.")
            return
            
        row = resp.data[0]
        call_id = row["call_id"]
        audio_url = row["audio_url"]
        language = row["language"]
        
        # Update status
        supabase.table("callizer_queue").update({"status": "Initializing..."}).eq("id", queue_id).execute()
        
        # 1. Download Audio or Use Local File
        downloads_dir = Path("../storage/temp_audio")
        downloads_dir.mkdir(parents=True, exist_ok=True)
        is_downloaded_temp_file = False
        
        if audio_url.startswith("http"):
            ext = "wav" # default fallback
            filename_part = audio_url.split('/')[-1]
            if '.' in filename_part:
                ext = filename_part.split('.')[-1][:4] # simple parse
                
            local_audio_path = downloads_dir / f"{call_id}.{ext}"
            
            logger.info(f"Downloading audio from {audio_url}")
            supabase.table("callizer_queue").update({"status": "Downloading audio file..."}).eq("id", queue_id).execute()
            
            # Audio URL is assumed to be a direct link or public S3 link
            r = requests.get(audio_url)
            r.raise_for_status()
            with open(local_audio_path, 'wb') as f:
                f.write(r.content)
            is_downloaded_temp_file = True
        else:
            logger.info(f"Using local audio file: {audio_url}")
            local_audio_path = Path(audio_url)
            if not local_audio_path.exists():
                raise FileNotFoundError(f"Local file not found: {local_audio_path}")
            
        # 2. Run ASR
        logger.info("Loading model...")
        supabase.table("callizer_queue").update({"status": "Loading AI models..."}).eq("id", queue_id).execute()
        device = pipeline.pick_device()
        model, device = pipeline.load_model(device)
        
        logger.info("Running ASR pipeline...")
        supabase.table("callizer_queue").update({"status": "Starting ASR pipeline..."}).eq("id", queue_id).execute()
        out_dir = Path("../storage/json_transcripts")
        out_dir.mkdir(parents=True, exist_ok=True)
        hf_token = os.environ.get("HF_TOKEN")
        
        def _status_cb(msg):
            logger.info(f"[{queue_id}] {msg}")
            try:
                supabase.table("callizer_queue").update({"status": msg}).eq("id", queue_id).execute()
            except Exception as e:
                logger.warning(f"Failed to update status for {queue_id} (non-fatal): {e}")

        result = pipeline.process_file(model, device, local_audio_path, language, hf_token, out_dir, status_callback=_status_cb)
        
        segments = result.get("speaker_turns", [])
        duration = segments[-1]["end"] if segments else 0.0
        
        # 2b. Compute talk-to-listen ratio from diarization segments
        speaker_durations = {}
        for seg in segments:
            speaker = seg.get("speaker", "Unknown")
            seg_duration = seg["end"] - seg["start"]
            speaker_durations[speaker] = speaker_durations.get(speaker, 0.0) + seg_duration
        
        total_speaking = sum(speaker_durations.values()) or 1.0
        participant_stats = {
            speaker: round(dur / total_speaking * 100)
            for speaker, dur in speaker_durations.items()
        }
        # Format as "71:29" (Agent:Customer) for display
        agent_pct = participant_stats.get("Agent", 0)
        customer_pct = participant_stats.get("Customer", 100 - agent_pct)
        talk_to_listen_ratio = f"{agent_pct}:{customer_pct}"
        
        logger.info(f"[{queue_id}] Talk-to-Listen Ratio: {talk_to_listen_ratio} | Stats: {participant_stats}")
        
        # 3. Translate to English (via translation microservice)
        logger.info("Translating segments to English...")
        supabase.table("callizer_queue").update({"status": "Translating to English..."}).eq("id", queue_id).execute()
        try:
            sentence_texts = [seg.get("text", "") for seg in segments]
            if sentence_texts:
                translations = translator.translate_batch(sentence_texts, src_lang=language)
                logger.info(f"[{queue_id}] Translation returned {len(translations)} results. Starting PII scrubbing...")
                
                # Check for failure rate
                failed_count = sum(1 for t in translations if not t or t == "[TRANSLATION_FAILED]")
                if len(translations) > 0 and (failed_count / len(translations)) > 0.2:
                    raise Exception(f"Translation failure rate too high: {failed_count}/{len(translations)} failed")
                
                for i, (seg, text_en) in enumerate(zip(segments, translations)):
                    # SCRUB PII from the english translation
                    safe_text = pii_scrubber.scrub_pii(text_en)
                    seg["text_en"] = safe_text
                logger.info(f"[{queue_id}] Translation and PII scrubbing complete — {len(translations)} segments processed.")
        except Exception as translate_err:
            logger.error(f"Translation failed: {translate_err}")
            # Policy: Hard halt, do not send Indic text to LLM
            supabase.table("callizer_queue").update({
                "status": "failed_translation",
                "errors": json.dumps([str(translate_err)])
            }).eq("id", queue_id).execute()
            return
        
        # 4. Save to calls table FIRST so QC evaluation can find it
        internal_call_id = str(uuid.uuid4())
        prospect_id = row.get("prospect_id", "")
        
        call_data = {
            "id": internal_call_id,
            "run_id": "lsq_auto",
            "filename": local_audio_path.name,
            "language": language,
            "duration_sec": duration,
            "rating": "Pending",
            "notes": "",
            "qc_status": "pending",
            "segments": json.dumps(segments),
            "audio_url": audio_url,
            "prospect_id": prospect_id if prospect_id else None,
            "source": "phone_call",
            "talk_to_listen_ratio": talk_to_listen_ratio,
            "participant_stats": json.dumps(participant_stats),
        }
        
        logger.info(f"[{queue_id}] Inserting call data into Supabase...")
        supabase.table("calls").insert(call_data).execute()
        logger.info(f"[{queue_id}] Saved call data to Supabase (ID: {internal_call_id})")

        # 5. Run QC Coaching via QA_LLm service
        logger.info("Running QC Coaching evaluation via Gemini...")
        supabase.table("callizer_queue").update({"status": "Running QC Coaching analysis..."}).eq("id", queue_id).execute()
        
        try:
            logger.info(f"[{queue_id}] Triggering QC Evaluation on Port 3000...")
            qc_resp = requests.post(
                "http://localhost:3000/api/qc/evaluate_call",
                json={
                    "call_id": internal_call_id,
                    "prospect_id": prospect_id if prospect_id else None,
                    "source": "phone_call"
                },
                timeout=15  # Returns 202 immediately now
            )
            qc_resp.raise_for_status()
            qc_data = qc_resp.json()
            
            if qc_data.get("success") and qc_data.get("coaching_report"):
                report = qc_data["coaching_report"]
                logger.info(f"QC Coaching complete — Score: {report.get('overall_score')}/100 ({report.get('overall_grade')})")
            else:
                logger.warning(f"QC evaluation returned no coaching report: {qc_data}")
        except Exception as qc_err:
            logger.warning(f"QC Coaching evaluation failed (non-fatal): {qc_err}")
            # Graceful degradation — continue without QC results
            
        # Mark queue as complete
        supabase.table("callizer_queue").update({"status": "completed"}).eq("id", queue_id).execute()
        logger.info(f"Queue item {queue_id} completed successfully.")
        
        # 5. AUTO-DELETE AUDIO FILE (Optimization)
        try:
            if is_downloaded_temp_file and local_audio_path.exists():
                os.remove(local_audio_path)
                logger.info(f"Deleted temp audio file {local_audio_path} to save space.")
        except Exception as cleanup_err:
            logger.warning(f"Failed to delete {local_audio_path}: {cleanup_err}")
            
    except Exception as e:
        logger.error(f"Error processing queue_id {queue_id}: {e}", exc_info=True)
        if supabase:
            supabase.table("callizer_queue").update({
                "status": "failed", 
                "errors": json.dumps([str(e)])
            }).eq("id", queue_id).execute()
    finally:
        # Free up memory
        import gc
        gc.collect()
        import torch
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
        elif torch.cuda.is_available():
            torch.cuda.empty_cache()