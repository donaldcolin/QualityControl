"""
ASR Pipeline Benchmark Script
Measures per-stage latency on the current hardware (Apple Silicon M1).
Uses a real audio file from the uploads directory.
"""
import time
import sys
import os
import json
from pathlib import Path

# Force offline mode
os.environ["HF_HUB_CACHE"] = str(Path(__file__).parent / "local_models")
os.environ.pop("HF_HUB_OFFLINE", None)

# DEBT D1: Pyannote's lightning_fabric calls torch.load without weights_only=False.
# PyTorch >= 2.6 defaults to weights_only=True, blocking Pyannote model loading.
# This patch is the exact issue documented in QC_Platform_v3 §30.
# Remove when Pyannote supports PyTorch 2.6+ natively.
import torch
_orig_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    kwargs["weights_only"] = False
    return _orig_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

def format_time(seconds):
    if seconds < 1:
        return f"{seconds*1000:.0f} ms"
    return f"{seconds:.2f} s"

def run_benchmark(audio_path, lang="hi"):
    import torch
    import torchaudio
    
    results = {}
    audio_path = Path(audio_path)
    
    print(f"\n{'='*60}")
    print(f"  ASR PIPELINE BENCHMARK")
    print(f"  File: {audio_path.name}")
    print(f"  Device: ", end="")
    
    # ── Device ──
    if torch.backends.mps.is_available():
        device = "mps"
    elif torch.cuda.is_available():
        device = "cuda"
    else:
        device = "cpu"
    print(f"{device}")
    print(f"  PyTorch: {torch.__version__}")
    print(f"{'='*60}\n")

    # ── Stage 1: ffmpeg conversion ──
    print("[1/7] ffmpeg conversion (→ 16kHz mono WAV)...", end=" ", flush=True)
    t0 = time.perf_counter()
    
    import imageio_ffmpeg
    import subprocess
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    tmp_wav = audio_path.with_suffix(".benchmark.16k.wav")
    subprocess.run(
        [ffmpeg_exe, "-y", "-i", str(audio_path), "-ar", "16000", "-ac", "1", str(tmp_wav)],
        check=True, capture_output=True,
    )
    t_ffmpeg = time.perf_counter() - t0
    results["ffmpeg_conversion"] = t_ffmpeg
    print(f"{format_time(t_ffmpeg)}")

    # ── Stage 2: Load waveform ──
    print("[2/7] Loading waveform into memory...", end=" ", flush=True)
    t0 = time.perf_counter()
    wav, sr = torchaudio.load(str(tmp_wav))
    wav = torch.mean(wav, dim=0, keepdim=True)
    if sr != 16000:
        wav = torchaudio.transforms.Resample(orig_freq=sr, new_freq=16000)(wav)
        sr = 16000
    t_load = time.perf_counter() - t0
    results["waveform_load"] = t_load
    
    audio_duration_sec = wav.shape[-1] / sr
    results["audio_duration_sec"] = audio_duration_sec
    print(f"{format_time(t_load)}  (audio: {audio_duration_sec:.1f}s)")
    
    # Cleanup temp
    try:
        tmp_wav.unlink()
    except OSError:
        pass

    # ── Stage 3: Silence trimming ──
    print("[3/7] Silence trimming...", end=" ", flush=True)
    t0 = time.perf_counter()
    
    from asr.asr_pipeline import _trim_silence
    trimmed_wav, silence_offset = _trim_silence(wav, sr)
    trimmed_duration = trimmed_wav.shape[-1] / sr
    
    t_trim = time.perf_counter() - t0
    results["silence_trim"] = t_trim
    results["trimmed_duration_sec"] = trimmed_duration
    results["silence_trimmed_sec"] = silence_offset
    print(f"{format_time(t_trim)}  (trimmed {silence_offset:.1f}s leading silence, {trimmed_duration:.1f}s remains)")

    # ── Stage 4: Model loading ──
    print("[4/7] Loading ASR model (IndicConformer-600M)...", end=" ", flush=True)
    t0 = time.perf_counter()
    
    from asr.asr_pipeline import load_model
    # Reset cached model to force a fresh load for benchmarking
    import asr.asr_pipeline as pipeline_mod
    pipeline_mod._cached_model = None
    pipeline_mod._cached_device = None
    
    model, actual_device = load_model(device)
    t_model_load = time.perf_counter() - t0
    results["model_load"] = t_model_load
    results["actual_device"] = actual_device
    print(f"{format_time(t_model_load)}  (on {actual_device})")

    # ── Stage 5: Diarisation ──
    print("[5/7] Speaker diarisation (pyannote 3.0)...", end=" ", flush=True)
    
    # Reset cached pipeline for fresh benchmark
    pipeline_mod._cached_diarization_pipeline = None
    
    # Check for HF token
    from dotenv import load_dotenv
    load_dotenv()
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_TOKEN")
    
    t0 = time.perf_counter()
    from asr.asr_pipeline import diarize
    speakers = diarize(trimmed_wav, sr, hf_token, device=actual_device, num_speakers=2)
    t_diarize = time.perf_counter() - t0
    results["diarisation"] = t_diarize
    results["raw_segments"] = len(speakers)
    print(f"{format_time(t_diarize)}  ({len(speakers)} raw segments)")

    # ── Stage 6: Segment merging ──
    print("[6/7] Segment merging...", end=" ", flush=True)
    t0 = time.perf_counter()
    from asr.asr_pipeline import _merge_short_segments
    merged = _merge_short_segments(speakers)
    t_merge = time.perf_counter() - t0
    results["segment_merge"] = t_merge
    results["merged_segments"] = len(merged)
    print(f"{format_time(t_merge)}  ({len(speakers)} → {len(merged)} segments)")

    # ── Stage 7: Transcription ──
    print(f"[7/7] Transcribing {len(merged)} segments (lang={lang})...", end=" ", flush=True)
    t0 = time.perf_counter()
    
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from asr.asr_pipeline import _transcribe_segment
    
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = {}
        for i, turn in enumerate(merged):
            future = executor.submit(
                _transcribe_segment, model, actual_device, trimmed_wav, sr, lang, i, turn
            )
            futures[future] = i
        for future in as_completed(futures):
            idx, text = future.result()
            merged[idx]["text"] = text
    
    t_transcribe = time.perf_counter() - t0
    results["transcription"] = t_transcribe
    print(f"{format_time(t_transcribe)}")

    # ── Summary ──
    total_pipeline = t_ffmpeg + t_load + t_trim + t_diarize + t_merge + t_transcribe
    total_with_model = total_pipeline + t_model_load
    rtf = audio_duration_sec / total_pipeline if total_pipeline > 0 else 0
    rtf_with_load = audio_duration_sec / total_with_model if total_with_model > 0 else 0
    
    results["total_pipeline_sec"] = total_pipeline
    results["total_with_model_load_sec"] = total_with_model
    results["realtime_factor"] = rtf
    results["realtime_factor_with_load"] = rtf_with_load
    
    print(f"\n{'='*60}")
    print(f"  BENCHMARK RESULTS")
    print(f"{'='*60}")
    print(f"  Audio duration:          {audio_duration_sec:.1f} s ({audio_duration_sec/60:.1f} min)")
    print(f"  Trimmed duration:        {trimmed_duration:.1f} s")
    print(f"  Device:                  {actual_device}")
    print(f"")
    print(f"  ┌─────────────────────────┬────────────┬────────────┐")
    print(f"  │ Stage                   │    Time    │  % of Total│")
    print(f"  ├─────────────────────────┼────────────┼────────────┤")
    stages = [
        ("ffmpeg conversion", t_ffmpeg),
        ("Waveform load", t_load),
        ("Silence trim", t_trim),
        ("Diarisation", t_diarize),
        ("Segment merge", t_merge),
        ("Transcription", t_transcribe),
    ]
    for name, t in stages:
        pct = (t / total_pipeline * 100) if total_pipeline > 0 else 0
        print(f"  │ {name:<23} │ {format_time(t):>10} │ {pct:>9.1f}% │")
    print(f"  ├─────────────────────────┼────────────┼────────────┤")
    print(f"  │ {'TOTAL (excl. model load)':<23} │ {format_time(total_pipeline):>10} │    100.0% │")
    print(f"  │ {'Model load (one-time)':<23} │ {format_time(t_model_load):>10} │       N/A │")
    print(f"  └─────────────────────────┴────────────┴────────────┘")
    print(f"")
    print(f"  Real-time factor:        {rtf:.2f}× (higher = faster)")
    print(f"  Real-time factor (cold): {rtf_with_load:.2f}× (includes model load)")
    print(f"")
    if rtf >= 21.0:
        print(f"  ✅ PASSES 21× target for M4 Pro pilot")
    elif rtf >= 14.75:
        print(f"  ⚠️  Passes 14.75× minimum but below 21× target")
    else:
        print(f"  ❌ BELOW 14.75× minimum — needs optimisation or more workers")
    print(f"{'='*60}\n")
    
    # Save JSON results
    results_path = Path(__file__).parent / "benchmark_results.json"
    results_path.write_text(json.dumps(results, indent=2))
    print(f"  Results saved to: {results_path}")
    
    # Print sample transcript
    print(f"\n  Sample transcript (first 3 segments):")
    for seg in merged[:3]:
        speaker = seg.get("speaker", "?")
        text = seg.get("text", "")[:80]
        print(f"    [{speaker}] {text}")
    
    return results


if __name__ == "__main__":
    # Pick the first available mp3 from uploads
    uploads = Path(__file__).parent / "uploads"
    audio_file = None
    
    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
    else:
        # Find a reasonable-sized mp3
        for d in sorted(uploads.iterdir()):
            if not d.is_dir():
                continue
            for f in d.iterdir():
                if f.suffix.lower() == ".mp3":
                    audio_file = str(f)
                    break
            if audio_file:
                break
    
    if not audio_file:
        print("No audio file found in uploads/. Pass a path as argument.")
        sys.exit(1)
    
    run_benchmark(audio_file, lang="hi")
