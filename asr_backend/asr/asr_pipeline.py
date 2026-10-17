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
import re
import subprocess
import os
import logging
import warnings
import threading
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

def _merge_short_segments(segments, gap_threshold=0.3, min_duration=0.3, max_duration=15.0):
    """
    Merge consecutive segments from the same speaker that are separated
    by less than gap_threshold seconds, or that are shorter than min_duration.
    Prevents merged segments from exceeding max_duration to ensure ASR accuracy.
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
        
        would_exceed_max = (seg["end"] - prev["start"]) > max_duration

        if same_speaker and (gap < gap_threshold or prev_too_short or seg_too_short) and not would_exceed_max:
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
    Transcribe a pre-loaded CPU wav tensor (or a time-slice of it) using CTC decoding.
    IndicConformer is ONNX Runtime on CPU (sessions are thread-safe and release the GIL), so
    worker threads run in parallel. Do not add a lock here: it halved throughput (Oct 11 regression).
    """
    import torch
    lang_code = _LANG_MAP.get(lang, lang)

    # Slice to segment boundaries if provided (slicing is thread-safe on cpu tensor)
    if start is not None and end is not None:
        start_sample = int(start * sr)
        end_sample = int(end * sr)
        wav = wav[:, start_sample:end_sample]

    # Skip empty/tiny segments
    if wav.shape[-1] < sr * 0.1:  # less than 100ms
        return ""

    with torch.inference_mode():
        return model(wav, lang_code, "ctc")


def _transcribe_segment(model, device, wav, sr, lang, idx, turn):
    """Helper for concurrent transcription — transcribes one segment."""
    text = transcribe(model, device, wav, sr, lang,
                      start=turn["start"], end=turn["end"])
    return idx, text


# ── Custom Diarization (Singleton) ────────────────────────────────────────

_cached_silero_vad = None
_cached_silero_utils = None
_cached_ecapa_model = None

def diarize(wav, sr, hf_token: str, device: str = "cpu", num_speakers=2):
    """
    Run custom fast diarization using Silero VAD and SpeechBrain ECAPA-TDNN.
    Supports fixed num_speakers (e.g. 2 for phone calls) or dynamic auto-clustering
    evaluating k in [2, 3, 4, 5] using Silhouette Score for multi-party video demos.
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
        min_silence_duration_ms=100,
        max_speech_duration_s=15.0  # Force split long monologues so ASR doesn't drop text
    )
    
    if not speech_timestamps:
        return []
        
    # 3. Extract embeddings (Batched for massive RTF speedup)
    valid_segments = speech_timestamps
    crops = []
    for seg in valid_segments:
        start_sample = int(seg['start'] * sr)
        end_sample = int(seg['end'] * sr)
        
        # Max 4 seconds per crop to extract speaker embedding (prevents OOM on huge padded tensors)
        if end_sample - start_sample > 4 * sr:
            end_sample = start_sample + 4 * sr
            
        # extract 1D crop
        crops.append(wav[0, start_sample:end_sample])
        
    embeddings = []
    batch_size = 16  # smaller mini-batch to prevent unified memory spikes on Apple Silicon
    
    with torch.inference_mode():
        from torch.nn.utils.rnn import pad_sequence
        for i in range(0, len(crops), batch_size):
            batch_crops = crops[i:i+batch_size]
            
            # Pad sequences with zeros to match longest segment in the batch
            padded_batch = pad_sequence(batch_crops, batch_first=True)
            
            # Compute relative lengths so the model ignores the zero-padding (ensures identical quality)
            lengths = torch.tensor([len(c) for c in batch_crops], dtype=torch.float32, device=device)
            relative_lengths = lengths / lengths.max()
            
            # Extract embeddings for the entire batch in one pass
            emb = _cached_ecapa_model.encode_batch(padded_batch, wav_lens=relative_lengths)
            emb = emb.squeeze(1).cpu().numpy() # [batch_size, 192]
            
            if emb.ndim == 1:
                emb = emb[np.newaxis, :] # Handle edge case where batch_size=1
                
            embeddings.extend(emb)
        
    if not embeddings:
        return []
        
    if len(embeddings) == 1:
        return [{"start": valid_segments[0]['start'], "end": valid_segments[0]['end'], "speaker": "SPEAKER_00"}]
        
    # 4. Cluster embeddings
    embeddings = np.stack(embeddings)
    # Normalize for cosine similarity clustering using KMeans
    embeddings = embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)
    
    n_samples = len(embeddings)
    if num_speakers == "auto" or num_speakers is None:
        from sklearn.metrics import silhouette_score
        max_k = min(5, n_samples - 1)
        if max_k >= 2:
            best_score = -1.0
            best_k = 2
            for k in range(2, max_k + 1):
                km = KMeans(n_clusters=k, n_init=10, random_state=42).fit(embeddings)
                score = silhouette_score(embeddings, km.labels_)
                # Slight domain bonus (+0.02) for 3 clusters (common Kalvium demo setup)
                adjusted_score = score + (0.02 if k == 3 else 0.0)
                if adjusted_score > best_score:
                    best_score = adjusted_score
                    best_k = k
            logger.info(f"Dynamic diarization selected k={best_k} clusters (silhouette score={best_score:.4f})")
            clustering = KMeans(n_clusters=best_k, n_init=10, random_state=42).fit(embeddings)
        else:
            clustering = KMeans(n_clusters=min(2, n_samples), n_init=10, random_state=42).fit(embeddings)
    else:
        k = int(num_speakers) if num_speakers else 2
        k = min(k, n_samples)
        clustering = KMeans(n_clusters=k, n_init=10, random_state=42).fit(embeddings)

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
_CONCURRENT_WORKERS = 6  # Benchmarked on M1 Air: 6 is ~17% faster than 4 with identical text; 8 is slower (core contention)


def map_meeting_roles(speakers):
    """
    Infers speaker roles for multi-stakeholder Google Meet 1:1 counselling sessions.
    Supported roles:
      - 'Advisor': Primary counselling advisor driving presentation & discovery
      - 'Advisor: Senior': Senior manager / closer who joins mid/late call or closes
      - 'Student': Candidate discussing academics, 12th marks, coding interests
      - 'Parent': Family decision maker asking about fees, ROI, hostel, approvals
    """
    import re
    from collections import defaultdict

    if not speakers:
        return speakers, {}

    speaker_stats = defaultdict(lambda: {
        "turn_count": 0,
        "total_duration": 0.0,
        "first_start": float("inf"),
        "last_end": 0.0,
        "text": "",
        "student_cue_score": 0,
        "parent_cue_score": 0,
        "advisor_cue_score": 0,
    })

    STUDENT_KEYWORDS = re.compile(
        r"\b(12th|class 12|twelfth|boards|cbse|icse|state board|marks|percentage|percentile|pcm|physics|maths|mathematics|chemistry|computer science|coding|python|java|cse|school|college|hobbies|interest|doubt|btech|12वीं|बारहवीं|बोर्ड|मार्क्स|कोडिंग|कंप्यूटर|स्कूल|कॉलेज|छात्र|padhai|pariksha)\b",
        re.IGNORECASE
    )
    PARENT_KEYWORDS = re.compile(
        r"\b(fees|fee|cost|lakh|lakhs|rupees|payment|installments|installment|emi|loan|refund|discount|scholarship|budget|afford|hostel|food|security|safety|placement|package|salary|job guarantee|father|mother|papa|mummy|sir|uncle|aunty|ma'am|decision|फीस|पैसे|लाख|हॉस्टल|प्लेसमेंट|पैकेज|नौकरी|सैलरी|पिता|माता|पापा|मम्मी|paise|naukri)\b",
        re.IGNORECASE
    )
    ADVISOR_KEYWORDS = re.compile(
        r"\b(kalvium|curriculum|program|presentation|screen|slide|knet|k-net|portal|registration|mentor|faculty|bachelor|degree|counselling|session|voucher|काल्वियम|कल्पियम|प्रेजेंटेशन|स्क्रीन|स्लाइड|के-नेट|रजिस्ट्रेशन|डिग्री)\b",
        re.IGNORECASE
    )

    total_call_duration = max((s.get("end", 0.0) for s in speakers), default=0.0)

    for turn in speakers:
        spk = turn["speaker"]
        dur = max(0.0, turn.get("end", 0.0) - turn.get("start", 0.0))
        text = turn.get("text", "") or ""
        
        stats = speaker_stats[spk]
        stats["turn_count"] += 1
        stats["total_duration"] += dur
        stats["first_start"] = min(stats["first_start"], turn.get("start", 0.0))
        stats["last_end"] = max(stats["last_end"], turn.get("end", 0.0))
        stats["text"] += " " + text
        
        stats["student_cue_score"] += len(STUDENT_KEYWORDS.findall(text))
        stats["parent_cue_score"] += len(PARENT_KEYWORDS.findall(text))
        stats["advisor_cue_score"] += len(ADVISOR_KEYWORDS.findall(text))

    unique_speakers = list(speaker_stats.keys())
    if len(unique_speakers) == 1:
        for turn in speakers:
            turn["speaker"] = "Advisor"
        return speakers, {unique_speakers[0]: "Advisor"}

    def advisor_score(spk):
        st = speaker_stats[spk]
        start_bonus = max(0.0, 100.0 - st["first_start"])
        duration_weight = st["total_duration"]
        cue_weight = st["advisor_cue_score"] * 10.0
        return start_bonus + duration_weight + cue_weight

    primary_advisor = max(unique_speakers, key=advisor_score)
    assigned_roles = {primary_advisor: "Advisor"}
    remaining_speakers = [s for s in unique_speakers if s != primary_advisor]

    # Check for Senior Advisor / Closer Takeover
    senior_advisor = None
    for spk in list(remaining_speakers):
        st = speaker_stats[spk]
        starts_late = st["first_start"] > 1000.0 or (st["first_start"] > 0.35 * total_call_duration and st["first_start"] > 300.0)
        has_advisor_profile = st["advisor_cue_score"] > st["student_cue_score"] and st["total_duration"] > 30.0
        if starts_late and has_advisor_profile:
            senior_advisor = spk
            assigned_roles[spk] = "Advisor: Senior"
            remaining_speakers.remove(spk)
            break

    # Differentiate Student vs Parent among remaining attendees
    if len(remaining_speakers) == 1:
        spk = remaining_speakers[0]
        st = speaker_stats[spk]
        if st["parent_cue_score"] > st["student_cue_score"]:
            assigned_roles[spk] = "Parent"
        elif st["student_cue_score"] > 0:
            assigned_roles[spk] = "Student"
        else:
            assigned_roles[spk] = "Customer"
    elif len(remaining_speakers) >= 2:
        sorted_by_student = sorted(
            remaining_speakers, 
            key=lambda s: speaker_stats[s]["student_cue_score"] - speaker_stats[s]["parent_cue_score"],
            reverse=True
        )
        student_candidate = sorted_by_student[0]
        assigned_roles[student_candidate] = "Student"
        
        remaining_after_student = [s for s in remaining_speakers if s != student_candidate]
        sorted_by_parent = sorted(
            remaining_after_student,
            key=lambda s: speaker_stats[s]["parent_cue_score"],
            reverse=True
        )
        parent_candidate = sorted_by_parent[0]
        assigned_roles[parent_candidate] = "Parent"
        
        for other_spk in remaining_after_student[1:]:
            assigned_roles[other_spk] = "Participant"

    for turn in speakers:
        raw_spk = turn["speaker"]
        turn["speaker"] = assigned_roles.get(raw_spk, raw_spk)

    return speakers, assigned_roles


# The agent introduces the company; customers almost never say it. "கல்வியல்" (= education) is deliberately excluded.
_BRAND_PATTERN = re.compile(
    r"kalvium|kalviyam|கல்வியம்|காலவியம்|कल्वियम|काल्वियम|कल्पियम|कल्वीयम|ಕಲ್ವಿಯಂ|ಕಲ್ವಿಯಮ್|కల్వియం|కల్వియమ్|കൽവിയം",
    re.IGNORECASE,
)


def map_phone_roles(speakers):
    """
    Agent = the speaker who says the brand ("Kalvium") most; if nobody does (or it's a tie),
    the speaker who talks the most. Returns (speakers, raw->role map, method).
    """
    talk, brand = {}, {}
    for turn in speakers:
        spk = turn["speaker"]
        talk[spk] = talk.get(spk, 0.0) + turn["end"] - turn["start"]
        brand[spk] = brand.get(spk, 0) + len(_BRAND_PATTERN.findall(turn.get("text") or ""))

    ranked = sorted(talk, key=lambda s: (brand[s], talk[s]), reverse=True)
    top_brand = [s for s in talk if brand[s] == max(brand.values())]
    method = "brand_mention" if brand[ranked[0]] > 0 and len(top_brand) == 1 else "talk_time"
    if method == "talk_time":
        ranked = sorted(talk, key=talk.get, reverse=True)

    roles = {spk: "Agent" if i == 0 else "Customer" if i == 1 else f"Speaker_{i + 1}" for i, spk in enumerate(ranked)}
    for turn in speakers:
        turn["speaker"] = roles[turn["speaker"]]
    return speakers, roles, method


def process_file(model, device: str, audio_path: Path, lang: str, hf_token: str, out_dir: Path, status_callback=None, call_type: str = "phone", num_speakers=2):
    """
    Full pipeline for one file: convert → load → trim → diarize → merge → transcribe.
    
    Optimizations applied:
      1. Waveform loaded ONCE, fed to both diarization and transcription
      2. Leading/trailing silence trimmed before diarization
      3. Tiny same-speaker segments merged to reduce transcription calls
      4. Transcription runs concurrently (ONNX releases GIL)
      5. Multi-speaker dynamic clustering & semantic role inference for Google Meet video calls
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
    original_wav, sr = torchaudio.load(str(tmp_wav))
    num_channels = original_wav.shape[0]
    wav = torch.mean(original_wav, dim=0, keepdim=True)  # force mono
    if sr != 16000:
        wav = torchaudio.transforms.Resample(orig_freq=sr, new_freq=16000)(wav)
        original_wav = torchaudio.transforms.Resample(orig_freq=sr, new_freq=16000)(original_wav)
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
    effective_num_speakers = "auto" if call_type == "google_meet" else num_speakers
    speakers = diarize(trimmed_wav, sr, hf_token, device=device, num_speakers=effective_num_speakers)
    _update(f"Diarization complete — found {len(speakers)} raw segments")

    # ── Step 5: Map speaker labels (Stereo Metadata Priority + Heuristic Fallback) ──
    speaker_map = {}
    role_assignment_method = "heuristic"

    if call_type == "google_meet":
        # Keep raw cluster labels for segment merging and transcription.
        # Semantic multi-stakeholder role mapping will resolve them after transcription turns are generated.
        role_assignment_method = "pending_semantic"
    elif num_channels == 2:
        speaker_energy = {}
        for turn in speakers:
            spk = turn["speaker"]
            start_idx = int(turn["start"] * sr)
            end_idx = int(turn["end"] * sr)
            if spk not in speaker_energy:
                speaker_energy[spk] = {"L": 0.0, "R": 0.0}
            
            # Compute RMS energy for this segment on L and R channels
            end_idx = min(end_idx, original_wav.shape[-1])
            if start_idx < end_idx:
                L_energy = torch.sqrt(torch.mean(original_wav[0, start_idx:end_idx]**2)).item()
                R_energy = torch.sqrt(torch.mean(original_wav[1, start_idx:end_idx]**2)).item()
                speaker_energy[spk]["L"] += L_energy
                speaker_energy[spk]["R"] += R_energy
        
        # Determine roles based on which channel the speaker is loudest in
        for spk, energies in speaker_energy.items():
            if energies["L"] > energies["R"]:
                speaker_map[spk] = "Agent"
            else:
                speaker_map[spk] = "Customer"
                
        # Validate that we got exactly one Agent and one Customer
        if list(speaker_map.values()).count("Agent") == 1 and list(speaker_map.values()).count("Customer") == 1:
            role_assignment_method = "channel_metadata"
            logger.info("Successfully mapped roles using stereo channel metadata.")
        else:
            logger.warning("Stereo mapping failed (both on same channel). Falling back to heuristic.")
            speaker_map = {} # Reset and fallback

    if not speaker_map and call_type != "google_meet":
        # Phone roles need the transcript (who says "Kalvium"), so they are assigned after Step 7.
        role_assignment_method = "pending_phone"

    if speaker_map:
        for turn in speakers:
            turn["speaker"] = speaker_map[turn["speaker"]]

    # ── Step 6: Merge short segments ──
    speakers = _merge_short_segments(speakers, gap_threshold=2.0, min_duration=0.5)
    total = len(speakers)
    _update(f"Merged to {total} segments for transcription")

    # ── Step 7: Transcribe (concurrently) ──
    _update(f"Transcribing {total} segments...")
    
    transcription_wav = trimmed_wav.cpu()  # the ONNX model's preprocessor runs on CPU

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

    # ── Step 7b: Semantic Role Assignment for Google Meet Video Demos ──
    roles_detected = {}
    if role_assignment_method == "pending_phone":
        speakers, roles_detected, role_assignment_method = map_phone_roles(speakers)
        logger.info(f"Assigned phone roles for {audio_path.name} ({role_assignment_method}): {roles_detected}")
    elif call_type == "google_meet":
        _update("Running multi-stakeholder semantic role mapping...")
        speakers, roles_detected = map_meeting_roles(speakers)
        role_assignment_method = "semantic_multistakeholder"
        logger.info(f"Assigned multi-stakeholder roles for {audio_path.name}: {roles_detected}")

    # Adjust timestamps back to original audio (add back silence offset)
    if silence_offset > 0:
        for turn in speakers:
            turn["start"] += silence_offset
            turn["end"] += silence_offset

    result = {
        "file": audio_path.name,
        "language": lang,
        "call_type": call_type,
        "role_assignment_method": role_assignment_method,
        "roles_detected": roles_detected,
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
