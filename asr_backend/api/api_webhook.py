from fastapi import FastAPI, BackgroundTasks, HTTPException, Header
from urllib.parse import urlparse
import hmac
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

import os
import requests
import uuid
import threading
import time
import logging
from datetime import datetime, timezone, timedelta

# Generate a unique ID for this specific Mac/worker instance
WORKER_ID = str(uuid.uuid4())

def node_auth_headers() -> dict:
    return {"Authorization": f"Bearer {os.environ.get('INTERNAL_WORKER_SECRET', '')}"}

def get_current_qc_mode() -> str:
    """
    Fetches active mode ('dev' or 'prod') from Node backend.
    Defaults to 'dev' (M1 MacBook Air safe profile) if unreachable.
    """
    try:
        r = requests.get("http://localhost:3000/api/qc/mode", headers=node_auth_headers(), timeout=2)
        if r.status_code == 200:
            return r.json().get("mode", "dev")
    except Exception:
        pass
    return os.environ.get("QC_MODE", "dev")

def claim_next_job(mode: str):
    """
    Claims the next available queue item using Priority Preemption:
    P1 (Urgent Demos) > P2 (Standard Calls) > P3 (Backfills)
    In DEV mode, strictly respects the human gate (is_gated_admitted == True).
    In PROD mode, processes all pending items hands-free.
    """
    if not worker.supabase:
        return None

    # 1. Try stored procedure claim_next_queue_job_v2
    try:
        rpc_resp = worker.supabase.rpc("claim_next_queue_job_v2", {
            "p_worker_id": WORKER_ID,
            "p_mode": mode
        }).execute()
        if rpc_resp.data and len(rpc_resp.data) > 0:
            return rpc_resp.data[0]["id"]
    except Exception as rpc_err:
        logger.debug(f"RPC claim_next_queue_job_v2 notice (falling back to direct query): {rpc_err}")

    # 2. Resilient Direct Query Fallback
    try:
        query = worker.supabase.table("callizer_queue").select("id, call_id, priority, is_gated_admitted, attempt_count").eq("status", "pending")
        if mode == "dev":
            query = query.eq("is_gated_admitted", True)

        # Order by Priority ASC (P1 > P2 > P3), then FIFO
        query = query.order("priority", desc=False).order("created_at", desc=False).limit(1)
        res = query.execute()

        if res.data and len(res.data) > 0:
            candidate = res.data[0]
            item_id = candidate["id"]
            curr_attempts = candidate.get("attempt_count") or 0
            expiry_iso = (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat()

            update_res = worker.supabase.table("callizer_queue").update({
                "status": "claimed",
                "worker_id": WORKER_ID,
                "claimed_at": datetime.now(timezone.utc).isoformat(),
                "lease_expires_at": expiry_iso,
                "attempt_count": curr_attempts + 1
            }).eq("id", item_id).eq("status", "pending").execute()

            if update_res.data and len(update_res.data) > 0:
                return item_id
    except Exception as direct_err:
        logger.error(f"Direct claim fallback error: {direct_err}")

    return None

def queue_worker():
    """
    Background worker with dual-hardware execution profiles:
    - DEV MODE (M1 MacBook Air): Concurrency = 1 (serial), human-gated, adaptive thermal pacing (2s-12s).
    - PROD MODE (Mac mini M6): 24/7 continuous autonomous execution, hands-free.
    """
    logger.info(f"🚀 AI Worker daemon started [Worker ID: {WORKER_ID[:8]}...]")
    while True:
        try:
            if not worker.supabase:
                time.sleep(10)
                continue

            current_mode = get_current_qc_mode()
            item_id = claim_next_job(current_mode)

            if item_id:
                logger.info(f"⚡ Claimed queue item: {item_id} [Mode: {current_mode.upper()}]")

                stop_heartbeat = threading.Event()
                cancel_event = threading.Event()

                def heartbeat():
                    while not stop_heartbeat.is_set():
                        time.sleep(300)
                        if stop_heartbeat.is_set():
                            break
                        try:
                            check = worker.supabase.table("callizer_queue").select("worker_id").eq("id", item_id).execute()
                            if not check.data or check.data[0].get("worker_id") != WORKER_ID:
                                logger.error(f"Lost lease for {item_id}! Another worker claimed it. Signaling cooperative cancellation.")
                                cancel_event.set()
                                break
                            expiry_iso = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
                            worker.supabase.table("callizer_queue").update({
                                "lease_expires_at": expiry_iso
                            }).eq("id", item_id).execute()
                            logger.info(f"Renewed lease for {item_id} until {expiry_iso}")
                        except Exception as hb_err:
                            logger.warning(f"Heartbeat notice: {hb_err}")

                hb_thread = threading.Thread(target=heartbeat, daemon=True)
                hb_thread.start()

                try:
                    worker.process_queue_item(item_id, cancel_event=cancel_event)
                finally:
                    stop_heartbeat.set()

                # DEV MODE: Adaptive Thermal Pacing for M1 MacBook Air (Fanless SoC protection)
                if current_mode == "dev":
                    worker.adaptive_thermal_cooldown()
            else:
                # No eligible items: wait for wakeup event or sleep
                # In DEV mode: wait 60s
                # In PROD mode: wait 15s
                timeout = 15.0 if current_mode == "prod" else 60.0
                queue_event.wait(timeout=timeout)
                queue_event.clear()
        except Exception as e:
            if "nodename nor servname" in str(e) or "nodename nor servname provided" in str(e):
                logger.debug("Worker offline (No internet). Waiting for connection...")
                time.sleep(60)
            else:
                logger.error(f"Queue worker polling error: {e}")
                time.sleep(10)

# Start the smart polling queue
threading.Thread(target=queue_worker, daemon=True).start()

class MeetWebhookRequest(BaseModel):
    meeting_id: str
    recording_url: str
    host_email: str

ALLOWED_RECORDING_HOSTS = ("drive.google.com", "docs.google.com", ".googleusercontent.com", ".googleapis.com")

@app.post("/api/webhook/meet")
def meet_webhook(req: MeetWebhookRequest, x_webhook_secret: str = Header(default="")):
    """
    Ingests a Google Meet recording directly into Priority 1 (Urgent Demo).
    Callers must send X-Webhook-Secret matching MEET_WEBHOOK_SECRET.
    """
    expected = os.environ.get("MEET_WEBHOOK_SECRET", "")
    if not expected or not hmac.compare_digest(x_webhook_secret.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid webhook secret")

    url = urlparse(req.recording_url)
    host = (url.hostname or "").lower()
    if url.scheme != "https" or not any(host == h.lstrip(".") or host.endswith(h) for h in ALLOWED_RECORDING_HOSTS):
        raise HTTPException(status_code=400, detail="recording_url must be an https Google Drive/Storage link")
    if not worker.supabase:
        raise HTTPException(status_code=500, detail="Database not connected")

    # Governor safety: check killswitch via Node backend
    try:
        ks_resp = requests.get("http://localhost:3000/api/queue/governor/status", headers=node_auth_headers(), timeout=2)
        if ks_resp.status_code == 200 and ks_resp.json().get("emergencyKillswitch"):
            raise HTTPException(status_code=503, detail="Emergency killswitch is active. Intake halted.")
    except requests.exceptions.ConnectionError:
        pass  # Node offline — allow intake, worker will handle it

    # Dedup check
    import hashlib
    dedup_payload = f"google_meet::{req.meeting_id}::0::{req.recording_url}"
    dedup_hash = hashlib.sha256(dedup_payload.encode()).hexdigest()

    existing = worker.supabase.table("callizer_queue").select("id").eq("dedup_hash", dedup_hash).limit(1).execute()
    if existing.data and len(existing.data) > 0:
        return {"status": "duplicate_skipped", "existing_id": existing.data[0]["id"]}

    queue_id = str(uuid.uuid4())

    worker.supabase.table("callizer_queue").insert({
        "id": queue_id,
        "call_id": req.meeting_id,
        "audio_url": req.recording_url,
        "prospect_id": req.host_email,
        "status": "pending",
        "priority": 1,              # Priority 1 Express Pass
        "source_type": "google_meet",
        "dedup_hash": dedup_hash,
        "is_gated_admitted": True,  # Urgent demos always admit
        "language": "en"
    }).execute()

    # Wake up local worker instantly
    queue_event.set()

    return {"status": "accepted", "queue_id": queue_id, "priority": 1}

class ProcessAudioRequest(BaseModel):
    queue_id: str

@app.post("/api/process_audio")
def process_audio(req: ProcessAudioRequest):
    """
    Webhook called by Node.js. Wakes up the background worker to fetch from the DB instantly.
    """
    queue_event.set()
    return {"status": "event_set", "queue_id": req.queue_id}

@app.get("/health")
def health_check():
    mode = get_current_qc_mode()
    thermal = worker.get_macos_thermal_state()
    return {
        "status": "ok",
        "service": "python_ai_worker",
        "mode": mode,
        "thermal_state": thermal,
        "worker_id": WORKER_ID
    }

