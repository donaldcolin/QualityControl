from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import worker.queue_processor as worker

app = FastAPI(title="Quality Control Bake-off - AI Worker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import threading
import time
import logging
from datetime import datetime, timezone, timedelta

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# Event to instantly wake up the polling thread without waiting for the sleep timeout
queue_event = threading.Event()

import uuid

# Generate a unique ID for this specific Mac/worker instance
WORKER_ID = str(uuid.uuid4())

def queue_worker():
    """
    Background worker that continuously polls the database for 'pending' audio files.
    Uses distributed atomic locking to allow multiple Macs to run simultaneously 
    without processing the same file twice.
    """
    while True:
        try:
            if not worker.supabase:
                time.sleep(10)
                continue
                
            # ATOMIC LOCK: Grab the oldest pending item and lock it in one transaction
            resp = worker.supabase.rpc("claim_next_queue_job", {"p_worker_id": WORKER_ID}).execute()
                
            if resp.data and len(resp.data) > 0:
                item_id = resp.data[0]["id"]
                logger.info(f"Successfully claimed queue item: {item_id}")
                
                # Fencing token & Heartbeat mechanism with Cooperative Cancellation
                stop_heartbeat = threading.Event()
                cancel_event = threading.Event()

                def heartbeat():
                    while not stop_heartbeat.is_set():
                        # Renew lease every 5 minutes
                        time.sleep(300)
                        if stop_heartbeat.is_set(): break
                        
                        # Verify we still own the lease (fencing token)
                        check = worker.supabase.table("callizer_queue").select("worker_id").eq("id", item_id).execute()
                        if not check.data or check.data[0].get("worker_id") != WORKER_ID:
                            logger.error(f"Lost lease for {item_id}! Another worker claimed it. Signaling cooperative cancellation.")
                            cancel_event.set()
                            break
                            
                        # Renew lease
                        expiry_iso = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
                        worker.supabase.table("callizer_queue").update({
                            "lease_expires_at": expiry_iso
                        }).eq("id", item_id).execute()
                        logger.info(f"Renewed lease for {item_id} until {expiry_iso}")

                hb_thread = threading.Thread(target=heartbeat, daemon=True)
                hb_thread.start()

                try:
                    worker.process_queue_item(item_id, cancel_event=cancel_event)
                finally:
                    stop_heartbeat.set()
            else:
                # No pending items, wait for a webhook to wake us up instantly, fallback to 5 minutes
                queue_event.wait(timeout=300.0)
                queue_event.clear()
        except Exception as e:
            # If it's a DNS/network error (often happens when Mac goes to sleep), suppress the spam
            if "nodename nor servname" in str(e) or "nodename nor servname provided" in str(e):
                logger.debug(f"Worker offline (No internet). Waiting for connection...")
                time.sleep(60) # Sleep longer when offline
            else:
                logger.error(f"Queue worker polling error: {e}")
                time.sleep(10)

# Start the smart polling queue
threading.Thread(target=queue_worker, daemon=True).start()

class MeetWebhookRequest(BaseModel):
    meeting_id: str
    recording_url: str
    host_email: str
    
@app.post("/api/webhook/meet")
def meet_webhook(req: MeetWebhookRequest):
    """
    Ingests a Google Meet or Zoom recording directly into the pipeline.
    Expects an MP4 or M4A URL which will be processed by the audio extraction
    logic in the worker node automatically.
    """
    if not worker.supabase:
        raise HTTPException(status_code=500, detail="Database not connected")
        
    queue_id = str(uuid.uuid4())
    
    worker.supabase.table("callizer_queue").insert({
        "id": queue_id,
        "call_id": req.meeting_id,
        "audio_url": req.recording_url,
        "prospect_id": req.host_email, # using host_email as a fallback prospect ID for Meet
        "status": "pending",
        "language": "en" # default language for Meet, worker will auto-detect
    }).execute()
    
    # Wake up the local worker instantly
    queue_event.set()
    
    return {"status": "accepted", "queue_id": queue_id}

class ProcessAudioRequest(BaseModel):
    queue_id: str

@app.post("/api/process_audio")
def process_audio(req: ProcessAudioRequest):
    """
    Webhook called by Node.js. Instead of holding requests in memory, 
    we just wake up the background worker to fetch from the DB instantly.
    """
    queue_event.set()
    return {"status": "event_set", "queue_id": req.queue_id}

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "python_ai_worker"}
