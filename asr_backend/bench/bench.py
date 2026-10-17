"""
10-minute ASR benchmark: diarization accuracy + ASR speed/consistency, on MPS.

  venv/bin/python bench/bench.py prepare   # once: cut clips, build the per-second answer key, fetch the phone clip
  venv/bin/python bench/bench.py run       # after every change; add --save-ref once to store reference transcripts

Assets live in storage/bench/ (git-ignored):
  demoA.wav / demoB.wav   10-min slices of the sample Meet demo (28-38 min, 60-70 min)
  truth_demoA.json ...    per-second "who is on screen" from the Meet tile name label (video_analyzer)
  phone.wav               first 10 min of a real Tamil phone call from BENCH_PHONE_URL in asr_backend/.env (optional;
                          no answer key: roles are printed for a manual check)
  ref_<clip>.txt          reference transcript (--save-ref), used for CER
"""
import glob
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent           # asr_backend/
STORAGE = ROOT.parent / "storage"
BENCH = STORAGE / "bench"
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")
PHONE_URL = os.environ.get("BENCH_PHONE_URL")  # a real call URL contains phone numbers: keep it in .env, not git

DEMO_CLIPS = {"demoA": 1680, "demoB": 3600}            # start second in the demo recording
CLIP_SEC = 600
ASSOCIATE_FIRST_NAME = "hemalatha"                     # the sample demo's advisor
ADVISOR_ROLES = {"Advisor", "Advisor: Senior", "Agent"}
LANG = "ta"


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


# ── prepare ──────────────────────────────────────────────────────────────────

def build_truth(video, start):
    """Per-second tile owner ('associate'/'customer'/None) for [start, start+CLIP_SEC)."""
    import cv2
    import imagehash
    from PIL import Image
    import video_analyzer as va

    cap = cv2.VideoCapture(video)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    proc = subprocess.Popen([ffmpeg(), "-v", "error", "-ss", str(start), "-t", str(CLIP_SEC), "-i", video,
                             "-vf", "fps=1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    owners, prev_hash, prev_key, prev_layout = [], None, None, None
    while True:
        buf = proc.stdout.read(w * h * 3)
        if len(buf) < w * h * 3:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        layout, box = va._detect_layout(frame)
        if box is None:
            owners.append(None)
            continue
        x, y, bw, bh = box
        tile = frame[y:y + bh, x:x + bw]
        th = imagehash.phash(Image.fromarray(cv2.cvtColor(tile, cv2.COLOR_BGR2RGB)))
        key = prev_key
        if prev_hash is None or layout != prev_layout or (th - prev_hash) > va.TILE_CHANGE_HASH_DIFF or prev_key is None:
            key = va._first_name(va._read_name_label(tile)) or (prev_key if layout == prev_layout else None)
        prev_hash, prev_key, prev_layout = th, key, layout
        owners.append(None if not key else ("associate" if va._similar(key, ASSOCIATE_FIRST_NAME) else "customer"))
    proc.wait()
    return owners


def prepare():
    BENCH.mkdir(parents=True, exist_ok=True)
    video = glob.glob(str(STORAGE / "*.mp4"))[0]
    for name, start in DEMO_CLIPS.items():
        subprocess.run([ffmpeg(), "-v", "error", "-y", "-ss", str(start), "-t", str(CLIP_SEC), "-i", video,
                        "-map", "a", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(BENCH / f"{name}.wav")], check=True)
        owners = build_truth(video, start)
        (BENCH / f"truth_{name}.json").write_text(json.dumps(owners))
        print(f"{name}: {sum(o is not None for o in owners)}/{len(owners)} seconds labelled "
              f"({sum(o == 'associate' for o in owners)} associate, {sum(o == 'customer' for o in owners)} customer)")
    if not PHONE_URL:
        print("phone: skipped (set BENCH_PHONE_URL in asr_backend/.env)")
        return
    subprocess.run([ffmpeg(), "-v", "error", "-y", "-t", str(CLIP_SEC), "-i", PHONE_URL,
                    "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(BENCH / "phone.wav")], check=True)
    print("phone: 10 min clip saved")


# ── scoring helpers ──────────────────────────────────────────────────────────

def diarization_agreement(turns, owners):
    """2 s windows where the on-screen owner is stable (skipping 1 s after each tile switch for Meet's lag)."""
    n = ok = 0
    for t in range(1, len(owners) - 1, 2):
        o = owners[t]
        if o is None or owners[t + 1] != o or owners[t - 1] != o:
            continue
        talk = {}
        for s in turns:
            ov = min(t + 2, s["end"]) - max(t, s["start"])
            if ov > 0:
                side = "associate" if s["speaker"] in ADVISOR_ROLES else "customer"
                talk[side] = talk.get(side, 0) + ov
        if sum(talk.values()) < 0.5:
            continue
        n += 1
        ok += max(talk, key=talk.get) == o
    return (ok / n * 100 if n else float("nan")), n


def cer(ref, hyp):
    """Character error rate via a row-vectorised Levenshtein (numpy, no extra dependency)."""
    ref = ref.replace(" ", "")
    hyp = hyp.replace(" ", "")
    if not ref:
        return 0.0 if not hyp else 100.0
    a = np.frombuffer(ref.encode("utf-32-le"), dtype=np.uint32)
    b = np.frombuffer(hyp.encode("utf-32-le"), dtype=np.uint32)
    ar = np.arange(len(b) + 1)
    prev = ar.astype(np.int64)
    for i in range(1, len(a) + 1):
        sub = prev[:-1] + (b != a[i - 1])
        x = np.empty_like(prev)
        x[0] = i
        x[1:] = np.minimum(prev[1:] + 1, sub)
        prev = np.minimum.accumulate(x - ar) + ar  # resolves the left-to-right insertion chain
    return prev[-1] / len(a) * 100


# ── run ──────────────────────────────────────────────────────────────────────

def run(save_ref=False):
    import asr.asr_pipeline as P
    device = P.pick_device()
    model, device = P.load_model(device)
    out_dir = BENCH / "out"
    rows = []
    for name in list(DEMO_CLIPS) + (["phone"] if (BENCH / "phone.wav").exists() else []):
        wav = BENCH / f"{name}.wav"
        marks = {}
        t0 = time.perf_counter()

        def mark(msg):
            for key in ("Running speaker diarization", "Diarization complete", "Transcribing", "Saving results"):
                if msg.startswith(key) and key not in marks:
                    marks[key] = time.perf_counter()

        call_type = "phone" if name == "phone" else "google_meet"
        result = P.process_file(model, device, wav, LANG, None, out_dir, status_callback=mark, call_type=call_type)
        total = time.perf_counter() - t0
        turns = result["speaker_turns"]
        diar_s = marks["Diarization complete"] - marks["Running speaker diarization"]
        asr_s = marks["Saving results"] - marks["Transcribing"]
        text = " ".join((s.get("text") or "").strip() for s in sorted(turns, key=lambda s: s["start"]))

        ref_path = BENCH / f"ref_{name}.txt"
        if save_ref:
            ref_path.write_text(text)
        c = cer(ref_path.read_text(), text) if ref_path.exists() else float("nan")

        talk = {}
        for s in turns:
            talk[s["speaker"]] = talk.get(s["speaker"], 0) + s["end"] - s["start"]
        if name == "phone":
            agree, n = float("nan"), 0
            print("\nphone turns (manual Agent/Customer check):")
            for s in turns[:8]:
                print(f"  {s['start']:6.1f}s {s['speaker']:9s} {(s.get('text') or '')[:70]}")
        else:
            agree, n = diarization_agreement(turns, json.loads((BENCH / f"truth_{name}.json").read_text()))
        rows.append((name, agree, n, diar_s, asr_s, CLIP_SEC / asr_s, c, total, {k: round(v / 60, 1) for k, v in talk.items()}))

    print(f"\n{'clip':7s} {'diar agree':>10s} {'n':>4s} {'diar s':>7s} {'asr s':>6s} {'asr x-rt':>8s} {'CER%':>6s} {'total s':>7s}  talk min by role")
    for name, agree, n, d, a, rt, c, tot, talk in rows:
        print(f"{name:7s} {agree:9.1f}% {n:4d} {d:7.1f} {a:6.1f} {rt:7.1f}x {c:6.2f} {tot:7.1f}  {talk}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    if cmd == "prepare":
        prepare()
    else:
        run(save_ref="--save-ref" in sys.argv)
