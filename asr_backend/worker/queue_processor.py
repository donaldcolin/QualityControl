import os
import uuid
import json
import logging
import requests
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv

from supabase import create_client, Client

import asr.asr_pipeline as pipeline
import worker.pii_scrubber as pii_scrubber

logging.basicConfig(level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("speechbrain").setLevel(logging.ERROR)
logger = logging.getLogger("worker")

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)
load_dotenv()

supabase_url = os.environ.get("SUPABASE_URL", "")
supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
if supabase_url and supabase_key:
    supabase: Client = create_client(supabase_url, supabase_key)
else:
    logger.warning("SUPABASE_URL and SUPABASE_KEY not set in environment.")
    supabase = None


class LeaseLostException(Exception):
    """Raised when worker lease is preempted or lost during processing."""
    pass


def process_queue_item(queue_id: str, cancel_event: threading.Event = None):
    if not supabase:
        logger.error("Supabase client not initialized.")
        return

    def check_cancel(stage: str):
        if cancel_event and cancel_event.is_set():
            raise LeaseLostException(f"Worker lease lost before/during {stage}")
        
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
        call_type = row.get("call_type", "")
        call_date = row.get("call_date")
        # If it's explicitly a Video Demo or it's a locally uploaded MP4/MKV video, treat it as a google_meet demo
        if call_type == "Video Demo" or str(audio_url).lower().endswith(('.mp4', '.mkv', '.webm', '.mov')):
            source = "google_meet"
        else:
            source = "phone_call"
        
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
        check_cancel("ASR pipeline launch")
        hf_token = os.environ.get("HF_TOKEN")
        
        def _status_cb(msg):
            check_cancel(f"ASR stage: {msg}")
            import sys
            if msg.startswith("Transcribing segment"):
                sys.stdout.write(f"\rINFO:worker:[{queue_id}] {msg}")
                sys.stdout.flush()
            else:
                if "Transcribing segment" not in msg:
                    # ensure we drop a newline if we were just loading
                    sys.stdout.write("\n")
                    sys.stdout.flush()
                logger.info(f"[{queue_id}] {msg}")
                
            try:
                # Extend worker lease dynamically during active transcription so long jobs are not reclaimed
                expiry_iso = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
                supabase.table("callizer_queue").update({
                    "status": msg,
                    "lease_expires_at": expiry_iso
                }).eq("id", queue_id).execute()
            except Exception as e:
                logger.warning(f"\nFailed to update status for {queue_id} (non-fatal): {e}")

        result = pipeline.process_file(
            model, device, local_audio_path, language, hf_token, out_dir,
            status_callback=_status_cb, call_type=source
        )
        
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
        # Format as "71:29" (Sales:Customer) for display
        sales_roles = {"Agent", "Advisor", "Advisor: Senior"}
        agent_pct = sum(participant_stats.get(role, 0) for role in sales_roles)
        customer_pct = 100 - agent_pct
        talk_to_listen_ratio = f"{agent_pct}:{customer_pct}"
        
        logger.info(f"[{queue_id}] Talk-to-Listen Ratio: {talk_to_listen_ratio} | Stats: {participant_stats}")
        
        # 3. (Bypassed Translation) - Let Gemini process raw regional language natively
        # Apply multilingual PII scrubbing before egress
        for seg in segments:
            raw_text = seg.get("text", "")
            scrubbed_text = pii_scrubber.scrub_pii(raw_text)
            seg["text"] = scrubbed_text
            seg["text_en"] = scrubbed_text
        
        logger.info(f"[{queue_id}] Bypassed translation but applied PII pseudonymisation.")
        
        # 3.5 Run Video Analyzer for Google Meet calls
        # 4. Generate internal call ID early so we can link files to it
        internal_call_id = str(uuid.uuid4())
        
        # 3.5 Run Video Analyzer for Google Meet calls
        if source == "google_meet":
            try:
                logger.info(f"[{queue_id}] Running computer vision video analysis...")
                import video_analyzer
                
                # temp_audio directory is where drive_audio_extractor.js puts the temp mp4, 
                # but if it's a local upload, local_audio_path is already the mp4 file.
                if str(local_audio_path).lower().endswith(('.mp4', '.mkv', '.mov', '.webm')):
                    temp_mp4_path = local_audio_path
                    is_temp = False
                else:
                    temp_mp4_path = local_audio_path.parent / f"{queue_id}_temp.mp4"
                    is_temp = True

                if temp_mp4_path.exists():
                    # Process slides and analyze video
                    WORKSPACE = os.environ.get("WORKSPACE_DIR", str(Path(__file__).resolve().parent.parent.parent))
                    PDF_PATH = os.path.join(WORKSPACE, "storage", "reference_slides", "Kalvium_ B.Tech CSE to excel in career & life AY27.pdf")
                    SLIDES_DIR = os.path.join(WORKSPACE, "storage", "reference_slides", "images")
                    
                    slide_data = video_analyzer.extract_slides_from_pdf(PDF_PATH, SLIDES_DIR)
                    timeline, face_timeline, camera_pct = video_analyzer.analyze_video(str(temp_mp4_path), slide_data, interval_seconds=10)
                    
                    clean_slide_names = {
                        18: "Placement Statistics & Outcomes",
                        29: "Where Students Are Placed",
                        40: "Why Kalvium (Key Differentiators)",
                        63: "Curriculum & Methodology Overview",
                        112: "Detailed Fee Structure & Options"
                    }
                    
                    # Save timeline to storage directory using internal_call_id so qc_evaluations.js can pick it up
                    storage_dir = Path(WORKSPACE) / "storage"
                    json_report_path = storage_dir / f"{internal_call_id}_timeline.json"
                    
                    video_analyzer.generate_report(
                        timeline, face_timeline, slide_data, 
                        slide_names_config=clean_slide_names, 
                        debounce_sec=5, 
                        camera_pct=camera_pct, 
                        output_path=str(json_report_path)
                    )
                    logger.info(f"[{queue_id}] Video analysis complete. Timeline saved to {json_report_path}")
                    
                    # Clean up the large temp video file now that vision analysis is done (only if it was a drive temp file)
                    if is_temp:
                        try:
                            temp_mp4_path.unlink()
                            logger.info(f"[{queue_id}] Deleted heavy temp mp4 file: {temp_mp4_path.name}")
                        except OSError as e:
                            logger.warning(f"Failed to delete {temp_mp4_path}: {e}")
                else:
                    logger.warning(f"[{queue_id}] Expected {temp_mp4_path} for google_meet but it was missing!")
            except Exception as e:
                logger.error(f"[{queue_id}] Video Analysis Failed: {e}", exc_info=True)

        # 5. Save to calls table FIRST so QC evaluation can find it
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
            "source": source,
            "talk_to_listen_ratio": talk_to_listen_ratio,
            "participant_stats": json.dumps(participant_stats),
            "role_assignment_method": result.get("role_assignment_method", "heuristic"),
        }
        if call_date:
            call_data["call_date"] = call_date
        
        logger.info(f"[{queue_id}] Inserting call data into Supabase...")
        try:
            supabase.table("calls").insert(call_data).execute()
        except Exception as insert_err:
            if "call_date" in str(insert_err):
                logger.warning(f"[{queue_id}] 'call_date' column missing in calls table. Retrying without call_date. (Run v3_call_date_migration.sql in Supabase)")
                call_data.pop("call_date", None)
                supabase.table("calls").insert(call_data).execute()
            else:
                raise insert_err
        logger.info(f"[{queue_id}] Saved call data to Supabase (ID: {internal_call_id})")

        # 5. Run QC Coaching via QA_LLm service
        logger.info("Running QC Coaching evaluation via Gemini...")
        supabase.table("callizer_queue").update({"status": "Running QC Coaching analysis..."}).eq("id", queue_id).execute()
        
        try:
            logger.info(f"[{queue_id}] Triggering QC Evaluation on Port 3000...")
            worker_token = os.environ.get("INTERNAL_WORKER_SECRET", "internal_qc_worker_secret_2026")
            qc_resp = requests.post(
                "http://localhost:3000/api/qc/evaluate_call",
                headers={"Authorization": f"Bearer {worker_token}"},
                json={
                    "call_id": internal_call_id,
                    "prospect_id": prospect_id if prospect_id else None,
                    "source": source
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
        check_cancel("completion finalization")
        supabase.table("callizer_queue").update({"status": "completed"}).eq("id", queue_id).execute()
        logger.info(f"Queue item {queue_id} completed successfully.")
        
    except LeaseLostException as lle:
        logger.warning(f"🛡️ [{queue_id}] Cooperative cancellation triggered: {lle}. Aborting gracefully without overwriting queue state.")
    except Exception as e:
        logger.error(f"Error processing queue_id {queue_id}: {e}", exc_info=True)
        if supabase:
            supabase.table("callizer_queue").update({
                "status": "failed", 
                "errors": json.dumps([str(e)])
            }).eq("id", queue_id).execute()
    finally:
        # 1. GUARANTEED DISK CLEANUP OF TEMPORARY MEDIA
        try:
            # Check for temp video created for this queue item
            temp_mp4 = downloads_dir / f"{queue_id}_temp.mp4"
            if temp_mp4.exists():
                temp_mp4.unlink()
                logger.info(f"[{queue_id}] Guaranteed Cleanup: Deleted temp video {temp_mp4.name}")
        except Exception as cleanup_v_err:
            logger.warning(f"[{queue_id}] Failed to delete temp video: {cleanup_v_err}")

        try:
            if 'local_audio_path' in locals() and local_audio_path and local_audio_path.exists():
                # Delete if downloaded from HTTP or generated into storage/temp_audio for this queue item
                is_temp_artifact = (
                    is_downloaded_temp_file or 
                    ("temp_audio" in str(local_audio_path) and (queue_id in str(local_audio_path) or (call_id and call_id in str(local_audio_path))))
                )
                if is_temp_artifact:
                    os.remove(local_audio_path)
                    logger.info(f"[{queue_id}] Guaranteed Cleanup: Deleted temp audio {local_audio_path.name}")
        except Exception as cleanup_a_err:
            logger.warning(f"[{queue_id}] Failed to delete temp audio: {cleanup_a_err}")

        # 2. Free up GPU/MPS and RAM memory
        import gc
        gc.collect()
        import torch
        if torch.backends.mps.is_available():
            torch.mps.empty_cache()
        elif torch.cuda.is_available():
            torch.cuda.empty_cache()