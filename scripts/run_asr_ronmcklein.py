import sys
import os
import time
import json
from pathlib import Path

# Add asr_backend to python path
sys.path.insert(0, os.path.abspath("asr_backend"))
import asr.asr_pipeline as pipeline

def run_transcription():
    audio_path = Path("storage/temp_audio/RonMckline_test_audio.mp3").resolve()
    if not audio_path.exists():
        print(f"Error: {audio_path} does not exist!")
        return

    out_dir = Path("storage/json_transcripts").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== Starting IndicConformer ASR for {audio_path.name} ===")
    print(f"File size: {audio_path.stat().st_size / (1024*1024):.2f} MB")
    
    start_time = time.time()
    
    device = pipeline.pick_device()
    print(f"Using device: {device}")
    
    model_load_start = time.time()
    model, device = pipeline.load_model(device)
    print(f"Model loaded in {time.time() - model_load_start:.2f}s")

    last_update = time.time()
    def status_cb(msg):
        nonlocal last_update
        now = time.time()
        print(f"[{time.strftime('%H:%M:%S')}] {msg} (Elapsed: {now - start_time:.1f}s)")
        last_update = now

    hf_token = os.environ.get("HF_TOKEN")
    
    # Process audio with Tamil language code 'ta' and google_meet call type
    result = pipeline.process_file(
        model=model,
        device=device,
        audio_path=audio_path,
        lang="ta",
        hf_token=hf_token,
        out_dir=out_dir,
        status_callback=status_cb,
        call_type="google_meet"
    )

    total_time = time.time() - start_time
    print(f"\n=== ASR Complete in {total_time:.2f} seconds ({total_time/60:.2f} mins) ===")
    print(f"Total speaker turns: {len(result.get('speaker_turns', []))}")
    print(f"Output saved to: {out_dir / (audio_path.stem + '.json')}")

if __name__ == "__main__":
    run_transcription()
