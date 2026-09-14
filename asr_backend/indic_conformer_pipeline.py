"""
End-to-end test/bake-off pipeline for AI4Bharat's IndicConformer-600M-Multilingual
ASR model + pyannote diarization, tuned to run on an Apple Silicon (M1/M2) Mac.

Covers: transcription (CTC decoding), speaker diarization, MPS-with-CPU-fallback
device handling, and batch processing over a folder of test calls.

------------------------------------------------------------------------------
ONE-TIME SETUP
------------------------------------------------------------------------------
1. Create a clean environment and install dependencies. Note: do NOT install
   onnxruntime-gpu -- it has no macOS build and will fail on Apple Silicon.
3axfgc. 
    python3 -m venv venv && source venv/bin/activate
    pip install transformers torchaudio onnxruntime onnx pyannote.audio huggingface_hub

2. Authenticate with Hugging Face (IndicConformer is a gated model -- accept
   its terms on the model page first, then log in locally):

    huggingface-cli login

3. Accept the pyannote diarization model's license and grab a token:
    https://huggingface.co/pyannote/speaker-diarization-3.1

4. ffmpeg must be installed on your system for robust audio decoding:
    brew install ffmpeg

------------------------------------------------------------------------------
USAGE
------------------------------------------------------------------------------
Single file:
    python indic_conformer_pipeline.py call1.mp3 --lang hi --hf-token <token>

Batch (bake-off) over a folder, all calls in the same language:
    python indic_conformer_pipeline.py ./test_calls/ --lang ta --hf-token <token> --out ./results/

Language codes: hi (Hindi), ta (Tamil), kn (Kannada), te (Telugu), ml (Malayalam)
This is one multilingual model, so unlike per-language Whisper fine-tunes you
don't need separate model files -- just pass the right --lang per batch.
"""

import argparse
import json
import subprocess
import os
from pathlib import Path

# Force offline mode and point to local model cache
os.environ["HF_HUB_CACHE"] = str(Path(__file__).parent / "local_models")
os.environ["HF_HUB_OFFLINE"] = "1"



def pick_device() -> str:
    """Select best available device: MPS for Apple Silicon, CUDA, or CPU."""
    import torch
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def convert_to_16k_wav(input_path: Path, tmp_path: Path) -> None:
    """Normalize any input format (mp3/m4a/wav/...) to 16kHz mono wav via ffmpeg."""
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run(
        [ffmpeg_exe, "-y", "-i", str(input_path), "-ar", "16000", "-ac", "1", str(tmp_path)],
        check=True,
        capture_output=True,
    )


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


def transcribe(model, device: str, wav, sr: int, lang: str,
               start: float = None, end: float = None) -> str:
    """
    Transcribe a pre-loaded wav tensor (or a time-slice of it) using CTC decoding.
    """
    import torch
    # Map from frontend names to IndicConformer 2-letter codes
    lang_map = {
        "Hindi": "hi",
        "Tamil": "ta",
        "Kannada": "kn",
        "Telugu": "te",
        "Malayalam": "ml"
    }
    lang_code = lang_map.get(lang, lang)

    # Slice to segment boundaries if provided
    if start is not None and end is not None:
        start_sample = int(start * sr)
        end_sample = int(end * sr)
        wav = wav[:, start_sample:end_sample]

    wav = wav.to(device)

    try:
        with torch.inference_mode():
            # The model uses the lang code for CTC decoding
            return model(wav, lang_code, "ctc")
    except NotImplementedError:
        # Some ops aren't implemented for MPS yet -- fall back to CPU for this
        # one file rather than crashing the whole batch.
        model_cpu = model.to("cpu")
        with torch.inference_mode():
            result = model_cpu(wav.to("cpu"), lang_code, "ctc")
        # Move model back to original device for next call
        model.to(device)
        return result


_cached_diarization_pipeline = None

def diarize(wav_path: Path, hf_token: str, device: str = "cpu", num_speakers: int = 2):
    """Run pyannote speaker diarization and return a list of speaker turns."""
    global _cached_diarization_pipeline
    import torch
    from pyannote.audio import Pipeline as DiarizationPipeline
    
    if _cached_diarization_pipeline is None:
        _cached_diarization_pipeline = DiarizationPipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", use_auth_token=hf_token if hf_token else True
        )
        _cached_diarization_pipeline.to(torch.device(device))
        
    diarization = _cached_diarization_pipeline(str(wav_path), num_speakers=num_speakers)
    return [
        {"start": turn.start, "end": turn.end, "speaker": speaker}
        for turn, _, speaker in diarization.itertracks(yield_label=True)
    ]


def process_file(model, device: str, audio_path: Path, lang: str, hf_token: str, out_dir: Path, status_callback=None):
    """Full pipeline for one file: convert → diarize → transcribe per segment."""
    def _update(msg):
        if status_callback:
            status_callback(msg)

    _update("Converting audio to 16kHz WAV...")
    tmp_wav = audio_path.with_suffix(".16k.wav")
    convert_to_16k_wav(audio_path, tmp_wav)

    _update("Running speaker diarization...")
    speakers = diarize(tmp_wav, hf_token, device=device, num_speakers=None)
    total = len(speakers)
    _update(f"Diarization complete — found {total} speaker segments")

    # Map raw labels (e.g. SPEAKER_00, SPEAKER_01) to Agent/Customer.
    # Heuristic: the person who speaks first is the Agent.
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

    import torch
    import torchaudio
    
    _update("Loading audio into memory for fast slicing...")
    wav, sr = torchaudio.load(str(tmp_wav))
    wav = torch.mean(wav, dim=0, keepdim=True)  # force mono
    if sr != 16000:
        wav = torchaudio.transforms.Resample(orig_freq=sr, new_freq=16000)(wav)
        sr = 16000

    # Transcribe each speaker turn individually — slicing directly from memory!
    for i, turn in enumerate(speakers):
        _update(f"Transcribing segment {i+1}/{total} ({turn.get('speaker', '?')})...")
        turn["text"] = transcribe(model, device, wav, sr, lang,
                                  start=turn["start"], end=turn["end"])

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
