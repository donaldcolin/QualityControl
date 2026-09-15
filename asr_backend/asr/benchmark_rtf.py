"""
RTF Benchmark — measures real-time factor of the optimized ASR pipeline.
Uses the first 60 seconds of a real audio file.
"""
# -- Patch torch.load BEFORE any ML imports --
# PyTorch 2.6+ defaults weights_only=True which breaks pyannote/lightning checkpoints.
import torch
_orig_torch_load = torch.load
def _safe_torch_load(*a, **kw):
    kw["weights_only"] = False
    return _orig_torch_load(*a, **kw)
torch.load = _safe_torch_load
import sys
import os
import time
import torchaudio

# Add parent dir to path so we can import asr package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from asr.asr_pipeline import pick_device, load_model, process_file, convert_to_16k_wav
from pathlib import Path

# ── Config ──
AUDIO_FILE = "../storage/uploads/1788688844326-125829093-9611206091_8618856456_20260829_184736.mp3"
CLIP_DURATION = 60  # seconds
LANG = "hi"
HF_TOKEN = os.environ.get("HF_TOKEN", "")
OUT_DIR = Path("../storage/json_transcripts")

def create_60s_clip(source_path: str, output_path: str, duration: int = 60):
    """Extract first N seconds using ffmpeg via imageio_ffmpeg."""
    import imageio_ffmpeg
    import subprocess
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run(
        [ffmpeg_exe, "-y", "-i", source_path, "-t", str(duration), "-ar", "16000", "-ac", "1", output_path],
        check=True,
        capture_output=True,
    )

def main():
    print("=" * 60)
    print("RTF BENCHMARK — Optimized ASR Pipeline")
    print("=" * 60)

    # Step 1: Create 60s clip
    clip_path = "/tmp/benchmark_60s.wav"
    print(f"\n📎 Extracting first {CLIP_DURATION}s from test audio...")
    create_60s_clip(AUDIO_FILE, clip_path, CLIP_DURATION)

    # Verify duration
    wav, sr = torchaudio.load(clip_path)
    actual_duration = wav.shape[-1] / sr
    print(f"   Clip duration: {actual_duration:.1f}s | Sample rate: {sr}Hz")

    # Step 2: Load model (not counted in RTF — it's a one-time cost)
    print(f"\n🔧 Loading ASR model (one-time cost, not counted in RTF)...")
    device = pick_device()
    t_model_start = time.time()
    model, device = load_model(device)
    t_model = time.time() - t_model_start
    print(f"   Model loaded in {t_model:.1f}s on device: {device}")

    # Step 3: Warm-up run (first diarization loads the pyannote model)
    print(f"\n🔥 Warm-up run (loading pyannote diarization model)...")
    t_warmup_start = time.time()
    try:
        process_file(model, device, Path(clip_path), LANG, HF_TOKEN, OUT_DIR,
                     status_callback=lambda msg: print(f"   [warmup] {msg}"))
    except Exception as e:
        print(f"   Warm-up error (may be expected): {e}")
    t_warmup = time.time() - t_warmup_start
    print(f"   Warm-up complete in {t_warmup:.1f}s")

    # Step 4: Timed benchmark run
    print(f"\n⏱️  BENCHMARK RUN (all models pre-loaded)...")
    t_start = time.time()
    
    result = process_file(model, device, Path(clip_path), LANG, HF_TOKEN, OUT_DIR,
                          status_callback=lambda msg: print(f"   [{time.time()-t_start:.1f}s] {msg}"))
    
    t_total = time.time() - t_start

    # Step 5: Results
    segments = result.get("speaker_turns", [])
    rtf = t_total / actual_duration

    print(f"\n{'=' * 60}")
    print(f"📊 RESULTS")
    print(f"{'=' * 60}")
    print(f"   Audio duration:     {actual_duration:.1f}s")
    print(f"   Processing time:    {t_total:.1f}s")
    print(f"   RTF:                {rtf:.3f}")
    print(f"   Segments found:     {len(segments)}")
    print(f"   Speed:              {1/rtf:.1f}x real-time")
    print(f"{'=' * 60}")

    if rtf < 0.35:
        print("   ✅ TARGET MET — RTF is under 0.35!")
    elif rtf < 0.52:
        print("   ⬆️  IMPROVED — RTF is lower than baseline 0.52")
    else:
        print("   ⚠️  NO IMPROVEMENT — RTF is still >= 0.52")

    # Show a few transcribed segments
    print(f"\n📝 Sample transcriptions:")
    for seg in segments[:5]:
        text = seg.get("text", "")[:80]
        print(f"   [{seg['start']:.1f}s-{seg['end']:.1f}s] {seg['speaker']}: {text}")

    # Cleanup
    try:
        os.remove(clip_path)
    except OSError:
        pass

if __name__ == "__main__":
    main()
