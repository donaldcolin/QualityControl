from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import worker

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
                time.sleep(5)
                continue
                
            # Grab the oldest pending item
            resp = worker.supabase.table("callizer_queue")\
                .select("id")\
                .eq("status", "pending")\
                .order("created_at")\
                .limit(1)\
                .execute()
                
            if resp.data:
                item_id = resp.data[0]["id"]
                
                # ATOMIC LOCK: Try to claim the item. If another Mac grabbed it first, 
                # the status will no longer be 'pending' and this update will affect 0 rows.
                lock_resp = worker.supabase.table("callizer_queue")\
                    .update({"status": f"Initializing pipeline (Worker: {WORKER_ID[:8]})..."})\
                    .eq("id", item_id)\
                    .eq("status", "pending")\
                    .execute()
                
                if not lock_resp.data:
                    # Another Mac beat us to this file! Skip and find the next one.
                    logger.info(f"Race condition avoided. Another worker claimed {item_id}")
                    continue
                
                logger.info(f"Successfully claimed pending queue item: {item_id}")
                worker.process_queue_item(item_id)
            else:
                # No pending items, wait for a webhook to wake us up instantly
                queue_event.wait(timeout=5.0)
                queue_event.clear()
        except Exception as e:
            logger.error(f"Queue worker polling error: {e}")
            time.sleep(5)

# Start the smart polling queue
threading.Thread(target=queue_worker, daemon=True).start()

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
