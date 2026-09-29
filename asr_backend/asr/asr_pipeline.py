"""
End-to-end ASR pipeline: IndicConformer-600M + Pyannote diarization.
Tuned for Apple Silicon (M1/M2/M6).

Optimizations over baseline:
  1. Load waveform FIRST, feed it in-memory to both diarization and ASR
  2. Merge tiny same-speaker segments to reduce total transcription calls
  3. Trim leading/trailing silence before diarization
  4. Concurrent transcription using ThreadPoolExecutor (ONNX releases the GIL)
"""

import argparse
import json
import subprocess
import os
import logging
import warnings
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Suppress PyTorch 2.5 FutureWarnings (weights_only) and other library warnings
warnings.filterwarnings("ignore", category=FutureWarning, module="speechbrain")
warnings.filterwarnings("ignore", message=".*torch_dtype is deprecated.*")
warnings.filterwarnings("ignore", message=".*FRAME_DURATION_MS.*")

# Force offline mode and point to local model cache
# local_models is in the asr_backend root, one level above this asr/ subfolder
os.environ["HF_HUB_CACHE"] = str(Path(__file__).parent.parent / "local_models")
# os.environ["HF_HUB_OFFLINE"] = "1"

logger = logging.getLogger("asr_pipeline")


# ── Device Selection ────────────────────────────────────────────────────────

def pick_device() -> str:
    """Select best available device: MPS for Apple Silicon, CUDA, or CPU."""
    import torch
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


# ── Audio Conversion ────────────────────────────────────────────────────────

def convert_to_16k_wav(input_path: Path, tmp_path: Path) -> None:
    """Normalize any input format (mp3/m4a/wav/...) to 16kHz mono wav via ffmpeg."""
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run(
        [ffmpeg_exe, "-y", "-i", str(input_path), "-ar", "16000", "-ac", "1", str(tmp_path)],
        check=True,
        capture_output=True,
    )


# ── Model Loading (Singleton) ──────────────────────────────────────────────

_cached_model = None
_cached_device = None

def load_model(device: str):
    """Load IndicConformer and move to device, falling back to CPU if needed."""
    global _cached_model, _cached_device
    if _cached_model is not None:
        return _cached_model, _cached_device

    import torch
    from transformers import AutoModel
    model = AutoModel.from_pretrained(
        "ai4bharat/indic-conformer-600m-multilingual", 
        trust_remote_code=True,
        local_files_only=True,
        torch_dtype=torch.float16
    )
    try:
        model = model.to(device)
    except Exception:
        device = "cpu"
        model = model.to(device)
    model.eval()
    
    _cached_model = model
    _cached_device = device
    return model, device


# ── Silence Trimming ───────────────────────────────────────────────────────

def _trim_silence(wav, sr, threshold_db=-40.0, min_silence_sec=0.5):
    """
    Trim leading and trailing silence from a waveform using energy thresholding.
    Returns (trimmed_wav, offset_seconds) where offset_seconds is how many
    seconds were trimmed from the start (needed to adjust diarization timestamps).
    """
    import torch
    frame_len = int(sr * 0.025)  # 25ms frames
    hop = int(sr * 0.010)        # 10ms hop

    # Compute frame energies
    energy = wav.squeeze(0).unfold(0, frame_len, hop).pow(2).mean(dim=-1)
    energy_db = 10 * torch.log10(energy + 1e-10)

    threshold = threshold_db
    active = energy_db > threshold

    if not active.any():
        # All silence — return as-is
        return wav, 0.0

    first_active = active.nonzero(as_tuple=True)[0][0].item()
    last_active = active.nonzero(as_tuple=True)[0][-1].item()

    start_sample = max(0, first_active * hop - int(sr * 0.1))  # 100ms padding
    end_sample = min(wav.shape[-1], (last_active + 1) * hop + frame_len + int(sr * 0.1))

    offset_sec = start_sample / sr
    return wav[:, start_sample:end_sample], offset_sec


# ── Segment Merging ────────────────────────────────────────────────────────

def _merge_short_segments(segments, gap_threshold=0.3, min_duration=0.3):
    """
    Merge consecutive segments from the same speaker that are separated
    by less than gap_threshold seconds, or that are shorter than min_duration.
    This reduces the number of transcription calls.
    """
    if not segments:
        return segments

    merged = [segments[0].copy()]
    for seg in segments[1:]:
        prev = merged[-1]
        gap = seg["start"] - prev["end"]
        same_speaker = seg["speaker"] == prev["speaker"]
        prev_too_short = (prev["end"] - prev["start"]) < min_duration
        seg_too_short = (seg["end"] - seg["start"]) < min_duration

        if same_speaker and (gap < gap_threshold or prev_too_short or seg_too_short):
            # Merge: extend the previous segment
            prev["end"] = seg["end"]
        else:
            merged.append(seg.copy())

    return merged


# ── Transcription ──────────────────────────────────────────────────────────

# Language code mapping: frontend names → IndicConformer 2-letter codes
_LANG_MAP = {
    "Hindi": "hi",
    "Tamil": "ta",
    "Kannada": "kn",
    "Telugu": "te",
    "Malayalam": "ml",
}


def transcribe(model, device: str, wav, sr: int, lang: str,
               start: float = None, end: float = None) -> str:
    """
    Transcribe a pre-loaded wav tensor (or a time-slice of it) using CTC decoding.
    """
    import torch
    lang_code = _LANG_MAP.get(lang, lang)

    # Slice to segment boundaries if provided
    if start is not None and end is not None:
        start_sample = int(start * sr)
        end_sample = int(end * sr)
        wav = wav[:, start_sample:end_sample]

    # Skip empty/tiny segments
    if wav.shape[-1] < sr * 0.1:  # less than 100ms
        return ""

    wav = wav.to(device)

    try:
        with torch.inference_mode():
            return model(wav, lang_code, "ctc")
    except NotImplementedError:
        # Some ops aren't implemented for MPS yet — fall back to CPU
        model_cpu = model.to("cpu")
        with torch.inference_mode():
            result = model_cpu(wav.to("cpu"), lang_code, "ctc")
        model.to(device)
        return result


def _transcribe_segment(model, device, wav, sr, lang, idx, turn):
    """Helper for concurrent transcription — transcribes one segment."""
    text = transcribe(model, device, wav, sr, lang,
                      start=turn["start"], end=turn["end"])
    return idx, text


# ── Custom Diarization (Singleton) ────────────────────────────────────────

_cached_silero_vad = None
_cached_silero_utils = None
_cached_ecapa_model = None

def diarize(wav, sr, hf_token: str, device: str = "cpu", num_speakers: int = 2):
    """
    Run custom fast diarization using Silero VAD and SpeechBrain ECAPA-TDNN.
    Avoids re-reading the file from disk and skips heavy Pyannote inference.
    """
    global _cached_silero_vad, _cached_silero_utils, _cached_ecapa_model
    import torch
    import numpy as np
    from sklearn.cluster import KMeans
    from speechbrain.pretrained import EncoderClassifier
    from pathlib import Path
    
    # 1. Load models if not cached
    if _cached_silero_vad is None:
        _cached_silero_vad, _cached_silero_utils = torch.hub.load(
            repo_or_dir='snakers4/silero-vad',
            model='silero_vad',
            force_reload=False,
            trust_repo=True
        )
    
    if _cached_ecapa_model is None:
        savedir = str(Path(__file__).parent.parent / "local_models" / "speechbrain")
        _cached_ecapa_model = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=savedir,
            run_opts={"device": device}
        )
        
    # Silero VAD uses PyTorch JIT which crashes on MPS graph fuser.
    # We must run it on CPU. It is tiny so CPU is instant anyway.
    silero_model = _cached_silero_vad.to("cpu")
    wav_cpu = wav.to("cpu")
    wav = wav.to(device)
    
    get_speech_timestamps = _cached_silero_utils[0]
    
    # Silero requires 1D tensor for a single channel
    wav_1d = wav_cpu.squeeze(0) if wav_cpu.ndim > 1 else wav_cpu
    
    # 2. Get speech segments
    speech_timestamps = get_speech_timestamps(
        wav_1d, 
        silero_model, 
        sampling_rate=sr,
        return_seconds=True,
        min_speech_duration_ms=250,
        min_silence_duration_ms=100
    )
    
    if not speech_timestamps:
        return []
        
    # 3. Extract embeddings
    embeddings = []
    valid_segments = []
    
    for seg in speech_timestamps:
        start_sample = int(seg['start'] * sr)
        end_sample = int(seg['end'] * sr)
        
        crop = wav[:, start_sample:end_sample]
        
        with torch.inference_mode():
            emb = _cached_ecapa_model.encode_batch(crop)
            emb = emb.squeeze().cpu().numpy()
            
        embeddings.append(emb)
        valid_segments.append(seg)
        
    if not embeddings:
        return []
        
    if len(embeddings) == 1:
        return [{"start": valid_segments[0]['start'], "end": valid_segments[0]['end'], "speaker": "SPEAKER_00"}]
        
    # 4. Cluster embeddings
    embeddings = np.stack(embeddings)
    # Normalize for cosine similarity clustering using KMeans
    embeddings = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
    
    clustering = KMeans(n_clusters=num_speakers if num_speakers else 2, n_init=10).fit(embeddings)
    labels = clustering.labels_
    
    # 5. Format output
    results = []
    for seg, label in zip(valid_segments, labels):
        results.append({
            "start": seg['start'],
            "end": seg['end'],
            "speaker": f"SPEAKER_{label:02d}"
        })
        
    return results


# ── Main Pipeline ─────────────────────────────────────────────────────────

# Auto-detect: use more threads on machines with more RAM
_CONCURRENT_WORKERS = 4  # Increased for better RTF on Apple Silicon


def process_file(model, device: str, audio_path: Path, lang: str, hf_token: str, out_dir: Path, status_callback=None):
    """
    Full pipeline for one file: convert → load → trim → diarize → merge → transcribe.
    
    Optimizations applied:
      1. Waveform loaded ONCE, fed to both diarization and transcription
      2. Leading/trailing silence trimmed before diarization
      3. Tiny same-speaker segments merged to reduce transcription calls
      4. Transcription runs concurrently (ONNX releases GIL)
    """
    import torch
    import torchaudio

    def _update(msg):
        if status_callback:
            status_callback(msg)

    # ── Step 1: Convert to 16kHz WAV ──
    _update("Converting audio to 16kHz WAV...")
    tmp_wav = audio_path.with_suffix(".16k.wav")
    convert_to_16k_wav(audio_path, tmp_wav)

    # ── Step 2: Load waveform into memory (done ONCE) ──
    _update("Loading audio into memory...")
    wav, sr = torchaudio.load(str(tmp_wav))
    wav = torch.mean(wav, dim=0, keepdim=True)  # force mono
    if sr != 16000:
        wav = torchaudio.transforms.Resample(orig_freq=sr, new_freq=16000)(wav)
        sr = 16000

    # Clean up temp file early
    try:
        tmp_wav.unlink()
    except OSError:
        pass

    # ── Step 3: Trim silence ──
    _update("Trimming silence...")
    trimmed_wav, silence_offset = _trim_silence(wav, sr)
    audio_duration = trimmed_wav.shape[-1] / sr
    logger.info(f"Trimmed {silence_offset:.1f}s of leading silence, audio is {audio_duration:.1f}s")

    # ── Step 4: Diarize from memory ──
    _update("Running speaker diarization...")
    # Speed optimization: Forcing num_speakers=2 skips heavy clustering computation
    # Since these are BDA/sales calls, there are almost always exactly 2 speakers.
    speakers = diarize(trimmed_wav, sr, hf_token, device=device, num_speakers=2)
    _update(f"Diarization complete — found {len(speakers)} raw segments")

    # ── Step 5: Map speaker labels ──
    speaker_map = {}
    for turn in speakers:
        raw_label = turn["speaker"]
        if raw_label not in speaker_map:
            if len(speaker_map) == 0:
                speaker_map[raw_label] = "Agent"
            elif len(speaker_map) == 1:
                speaker_map[raw_label] = "Customer"
            else:
                speaker_map[raw_label] = f"Speaker_{len(speaker_map) + 1}"
        turn["speaker"] = speaker_map[raw_label]

    # ── Step 6: Merge short segments ──
    speakers = _merge_short_segments(speakers)
    total = len(speakers)
    _update(f"Merged to {total} segments for transcription")

    # ── Step 7: Transcribe (concurrently) ──
    _update(f"Transcribing {total} segments...")
    
    # Use the trimmed waveform for transcription
    transcription_wav = trimmed_wav

    with ThreadPoolExecutor(max_workers=_CONCURRENT_WORKERS) as executor:
        futures = {}
        for i, turn in enumerate(speakers):
            future = executor.submit(
                _transcribe_segment, model, device, transcription_wav, sr, lang, i, turn
            )
            futures[future] = i

        for future in as_completed(futures):
            idx, text = future.result()
            speakers[idx]["text"] = text
            done = sum(1 for s in speakers if "text" in s)
            _update(f"Transcribing segment {done}/{total}...")

    # Adjust timestamps back to original audio (add back silence offset)
    if silence_offset > 0:
        for turn in speakers:
            turn["start"] += silence_offset
            turn["end"] += silence_offset

    result = {
        "file": audio_path.name,
        "language": lang,
        "speaker_turns": speakers,
    }

    _update("Saving results...")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{audio_path.stem}.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"[done] {audio_path.name} -> {out_path}")
    return result


# ── CLI Entry Point ────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_path", help="Audio file or folder of audio files")
    parser.add_argument("--lang", required=True, choices=["hi", "ta", "kn", "te", "ml"])
    parser.add_argument("--hf-token", required=False, help="Hugging Face token for pyannote diarization (optional if running locally/offline)")
    parser.add_argument("--out", default="./results", help="Where to write per-call JSON results")
    args = parser.parse_args()

    device = pick_device()
    print(f"Using device: {device}")
    model, device = load_model(device)

    input_path = Path(args.input_path)
    out_dir = Path(args.out)

    files = (
        [input_path]
        if input_path.is_file()
        else sorted(
            p for p in input_path.iterdir() if p.suffix.lower() in {".mp3", ".wav", ".m4a", ".flac"}
        )
    )

    for f in files:
        try:
            process_file(model, device, f, args.lang, args.hf_token, out_dir)
        except Exception as e:
            print(f"[error] {f.name}: {e}")


if __name__ == "__main__":
    main()
