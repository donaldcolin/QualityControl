# -- Patch torch.load BEFORE any ML imports --
# PyTorch 2.6+ defaults weights_only=True which breaks pyannote/lightning checkpoints.
# We force weights_only=False because lightning passes it explicitly (not as a default),
# so setdefault doesn't work.
import torch
_orig_torch_load = torch.load
def _safe_torch_load(*a, **kw):
    kw["weights_only"] = False
    return _orig_torch_load(*a, **kw)
torch.load = _safe_torch_load

import os
import uuid
import json
import logging
import requests
from pathlib import Path
from dotenv import load_dotenv

from supabase import create_client, Client

import indic_conformer_pipeline as pipeline
import qc_agent

logging.basicConfig(level=logging.INFO)
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
        downloads_dir = Path("downloads")
        downloads_dir.mkdir(exist_ok=True)
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
        out_dir = Path("results")
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
        
        # 3. Translate to English (via translation microservice)
        logger.info("Translating segments to English...")
        supabase.table("callizer_queue").update({"status": "Translating to English..."}).eq("id", queue_id).execute()
        try:
            sentence_texts = [seg.get("text", "") for seg in segments]
            if sentence_texts:
                translate_resp = requests.post(
                    "http://localhost:8001/api/translate",
                    json={"sentences": sentence_texts, "src_lang": language},
                    timeout=300  # 5 min timeout for large calls on CPU
                )
                translate_resp.raise_for_status()
                translations = translate_resp.json().get("translations", [])
                for seg, text_en in zip(segments, translations):
                    seg["text_en"] = text_en
                logger.info(f"Translation complete — {len(translations)} segments translated.")
        except Exception as translate_err:
            logger.warning(f"Translation failed (non-fatal): {translate_err}")
            # Graceful degradation — continue without English translations
        
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
            "source": "phone_call"
        }
        
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
                timeout=180  # 3 min timeout for Gemini evaluation
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