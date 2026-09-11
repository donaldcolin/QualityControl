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

class ProcessAudioRequest(BaseModel):
    queue_id: str

@app.post("/api/process_audio")
def process_audio(req: ProcessAudioRequest, background_tasks: BackgroundTasks):
    """
    Called by the Node.js API Gateway to start processing an audio file.
    """
    background_tasks.add_task(worker.process_queue_item, req.queue_id)
    return {"status": "queued", "queue_id": req.queue_id}

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "python_ai_worker"}
