import os
import re
import json
import shutil
import subprocess
import tempfile
from difflib import SequenceMatcher
from pathlib import Path

import cv2
import imagehash
import numpy as np
from PIL import Image
import fitz  # PyMuPDF
import mediapipe as mp

DARK = 30                 # max channel value below which a pixel counts as black
AVATAR_DARK_FRACTION = 0.8  # Meet camera-off tile = flat dark background + small avatar circle
TILE_CHANGE_HASH_DIFF = 12  # re-read the name label only when the tile visibly changes
TESSERACT = shutil.which("tesseract") or "/opt/homebrew/bin/tesseract"


def extract_slides_from_pdf(pdf_path, output_dir):
    """
    Returns {page_number: {"hash": ImageHash}} for every PDF page.
    Hashes are cached in output_dir/slide_hashes.json and rebuilt only when the PDF changes.
    """
    os.makedirs(output_dir, exist_ok=True)
    stat = os.stat(pdf_path)
    cache_path = os.path.join(output_dir, "slide_hashes.json")

    try:
        with open(cache_path) as f:
            cache = json.load(f)
        if cache["pdf_mtime"] == stat.st_mtime and cache["pdf_size"] == stat.st_size:
            return {int(k): {"hash": imagehash.hex_to_hash(v)} for k, v in cache["hashes"].items()}
    except (OSError, ValueError, KeyError):
        pass  # no cache or stale cache: rebuild below

    print(f"Extracting slides from {pdf_path}...")
    doc = fitz.open(pdf_path)
    slide_data = {}
    for page_num in range(len(doc)):
        pix = doc.load_page(page_num).get_pixmap(matrix=fitz.Matrix(2, 2))  # 2x zoom for better resolution
        image_path = os.path.join(output_dir, f"slide_{page_num + 1}.png")
        if not os.path.exists(image_path):
            pix.save(image_path)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        slide_data[page_num + 1] = {"hash": imagehash.phash(img)}

    with open(cache_path, "w") as f:
        json.dump({
            "pdf_mtime": stat.st_mtime,
            "pdf_size": stat.st_size,
            "hashes": {str(k): str(v["hash"]) for k, v in slide_data.items()},
        }, f)
    print(f"Extracted and cached {len(slide_data)} slides.")
    return slide_data


def _sample_frames(video_path, interval_seconds):
    """
    Yields (timestamp_sec, BGR frame) once per interval, decoding keyframes only.
    Meet recordings have a keyframe every few seconds, so this skips ~99% of the decode work.
    """
    cap = cv2.VideoCapture(video_path)
    try:
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open video file {video_path}")
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    finally:
        cap.release()

    import imageio_ffmpeg
    frame_bytes = w * h * 3
    with tempfile.TemporaryFile() as err:
        proc = subprocess.Popen(
            [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-skip_frame", "nokey", "-i", video_path,
             "-vf", f"fps=1/{interval_seconds}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
            stdout=subprocess.PIPE, stderr=err,
        )
        try:
            n = 0
            while True:
                buf = proc.stdout.read(frame_bytes)
                if len(buf) < frame_bytes:
                    break
                yield n * interval_seconds, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
                n += 1
        finally:
            proc.stdout.close()
            if proc.poll() is None:
                proc.kill()
            rc = proc.wait()
        if rc not in (0, -9):
            err.seek(0)
            raise RuntimeError(f"ffmpeg frame extraction failed ({rc}): {err.read().decode(errors='replace')[-500:]}")


def _detect_layout(frame):
    """
    Returns ("presenting", tile_box_or_None) or ("tile", full_frame_box). Boxes are (x, y, w, h).
    Presenting = black letterbox rows top and bottom, plus a participant tile in the right 25% strip
    and/or a large solid content block (the shared screen) on the left.
    """
    h, w, _ = frame.shape
    nonblack = frame.max(axis=2) > DARK
    band = max(1, int(h * 0.05))
    if nonblack[:band].mean() >= 0.05 or nonblack[-band:].mean() >= 0.05:
        return "tile", (0, 0, w, h)  # not letterboxed: a webcam fills the frame

    split = int(w * 0.75)
    tile_box = None
    ys, xs = np.nonzero(nonblack[:, split:])
    if len(xs) > 0:
        bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        if bw > 0.15 * w and len(xs) / (bw * bh) > 0.8:  # solid rectangle = participant tile
            tile_box = (split + xs.min(), ys.min(), bw, bh)

    ys, xs = np.nonzero(nonblack[:, :split])
    big_left_content = False
    if len(xs) > 0:
        bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
        # A shared screen is a solid block; an avatar circle + name label spans a big box but is mostly empty
        big_left_content = bw > 0.5 * w and bh > 0.4 * h and len(xs) / (bw * bh) > 0.5

    if tile_box or big_left_content:
        return "presenting", tile_box
    return "tile", (0, 0, w, h)  # letterboxed but nothing presented: full-frame camera-off avatar


def _read_name_label(tile):
    """OCR the participant name Meet prints in white at the tile's bottom-left. Returns '' if unreadable."""
    h, w, _ = tile.shape
    label_h = max(34, int(h * 0.07))
    crop = tile[h - label_h:h, : int(w * 0.45)]
    big = cv2.resize(crop, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    white = (big.min(axis=2) > 215) & ((big.max(axis=2) - big.min(axis=2)) < 25)
    with tempfile.NamedTemporaryFile(suffix=".png") as tmp:
        cv2.imwrite(tmp.name, np.where(white, 0, 255).astype(np.uint8))
        try:
            out = subprocess.run([TESSERACT, tmp.name, "-", "--psm", "7"], capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            return ""
    return out.stdout.strip()


def _first_name(label):
    words = re.findall(r"[A-Za-z]{3,}", label)
    return words[0].lower() if words else None


def _similar(a, b):
    return SequenceMatcher(None, a, b).ratio() >= 0.75


def analyze_video(video_path, slide_data, interval_seconds=10, associate_name=None):
    """
    Samples the recording every `interval_seconds` and returns:
      timeline:      {sec: slide_number} while a known slide is presented
      face_timeline: {sec: {"owner": associate|customer|unknown, "camera_on": bool, "faces": int}}
      facial:        summary stats for generate_report
    Whose tile is on screen comes from the Meet name label (active speaker), not from face detection.
    """
    print(f"Analyzing video: {video_path}")
    associate_first = associate_name.split()[0].lower() if associate_name else None

    timeline = {}
    samples = []  # (sec, layout, name_key, camera_on, faces)
    prev_tile_hash, prev_key, prev_layout = None, None, None

    with mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.5) as face_detection:
        for sec, frame in _sample_frames(video_path, interval_seconds):
            h, w, _ = frame.shape
            layout, box = _detect_layout(frame)

            # --- Slides: only meaningful while presenting ---
            if layout == "presenting" and slide_data:
                content = cv2.cvtColor(frame[int(h * 0.1):int(h * 0.9), int(w * 0.05):int(w * 0.75)], cv2.COLOR_BGR2RGB)
                frame_hash = imagehash.phash(Image.fromarray(content))
                best_slide, best_diff = min(((n, frame_hash - d["hash"]) for n, d in slide_data.items()), key=lambda x: x[1])
                if best_diff <= 15:
                    timeline[sec] = best_slide

            if box is None:  # presenting with no participant tile visible
                samples.append((sec, layout, None, False, 0))
                continue

            x, y, bw, bh = box
            tile = frame[y:y + bh, x:x + bw]

            # --- Whose tile: re-read the label only when the tile changes ---
            tile_hash = imagehash.phash(Image.fromarray(cv2.cvtColor(tile, cv2.COLOR_BGR2RGB)))
            changed = prev_tile_hash is None or layout != prev_layout or (tile_hash - prev_tile_hash) > TILE_CHANGE_HASH_DIFF
            key = prev_key
            if changed or prev_key is None:
                key = _first_name(_read_name_label(tile)) or (prev_key if layout == prev_layout else None)
            prev_tile_hash, prev_key, prev_layout = tile_hash, key, layout

            # --- Camera on/off from the tile's look; faces only inside the tile ---
            camera_on = (tile.max(axis=2) <= DARK).mean() < AVATAR_DARK_FRACTION
            faces = 0
            if camera_on:
                result = face_detection.process(cv2.cvtColor(tile, cv2.COLOR_BGR2RGB))
                faces = len(result.detections or [])
            samples.append((sec, layout, key, camera_on, faces))

    # --- Resolve name keys to associate / customer (unknown without the associate's name) ---
    def owner_of(key):
        if not key or not associate_first:
            return "unknown"
        return "associate" if _similar(key, associate_first) else "customer"

    face_timeline = {}
    for sec, _, key, camera_on, faces in samples:
        face_timeline[sec] = {"owner": owner_of(key), "camera_on": bool(camera_on), "faces": faces}

    # --- Smooth the face count (people turn away): max over a ~30s window, never across owners ---
    secs = sorted(face_timeline)
    raw = [face_timeline[t]["faces"] for t in secs]
    for i, t in enumerate(secs):
        owner = face_timeline[t]["owner"]
        window = [raw[j] for j in range(max(0, i - 1), min(len(secs), i + 2)) if face_timeline[secs[j]]["owner"] == owner]
        face_timeline[t]["faces"] = max(window)

    facial = _summarize_faces(face_timeline)
    print(f"Video analysis: {len(samples)} samples, facial={facial}")
    return timeline, face_timeline, facial


def _summarize_faces(face_timeline):
    def pct(part, whole):
        return round(part / whole * 100, 1) if whole else None

    total = len(face_timeline)
    assoc = [s for s in face_timeline.values() if s["owner"] == "associate"]
    cust = [s for s in face_timeline.values() if s["owner"] == "customer"]
    assoc_cam = pct(sum(s["camera_on"] for s in assoc), len(assoc))
    return {
        "associate_camera_active_pct": assoc_cam,  # of the time the associate's tile was on screen
        "associate_visible_pct": pct(len(assoc), total),
        "customer_camera_active_pct": pct(sum(s["camera_on"] for s in cust), len(cust)),
        "max_people_on_customer_camera": max((s["faces"] for s in cust), default=0),
        "trust_metric_passed": None if assoc_cam is None else assoc_cam >= 50,
    }


def generate_report(timeline, face_timeline, slide_data, slide_names_config=None, debounce_sec=5,
                    facial=None, output_path="slide_report.json", interval_sec=10):
    """
    Aggregates the timeline into a structured JSON format for the frontend.
    Uses slide_names_config for clean titles when available.
    Also includes the face/camera timeline.
    """
    total_slides = len(slide_data)
    slide_intervals = {i: [] for i in range(1, total_slides + 1)}

    sorted_times = sorted(timeline.keys())
    current_slide = None
    start_time = None
    last_time = None

    for t in sorted_times:
        slide = timeline[t]
        if slide != current_slide:
            if current_slide is not None:
                # PILLAR 1: Debounce Rule (Ignore if shown for < debounce_sec)
                if last_time - start_time >= debounce_sec:
                    slide_intervals[current_slide].append((start_time, last_time))
            current_slide = slide
            start_time = t
        last_time = t

    if current_slide is not None and last_time - start_time >= debounce_sec:
        slide_intervals[current_slide].append((start_time, last_time))

    print(f"\n=== GENERATING JSON REPORT ({total_slides} Slides) ===")

    # Merge consecutive samples with the same owner / camera / face count into events
    face_events = []
    for t in sorted(face_timeline.keys()):
        s = face_timeline[t]
        state = (s["owner"], s["camera_on"], s["faces"])
        if face_events and face_events[-1]["_state"] == state:
            face_events[-1]["end_time"] = t + interval_sec
            continue
        if face_events:
            face_events[-1]["end_time"] = t
        face_events.append({"start_time": t, "end_time": t + interval_sec, "owner": s["owner"],
                            "camera_on": s["camera_on"], "faces_detected": s["faces"], "_state": state})
    for e in face_events:
        del e["_state"]

    json_output = {
        "facial_analytics": facial or _summarize_faces(face_timeline),
        "face_timeline": face_events,
        "slides": []
    }

    for slide_num in range(1, total_slides + 1):
        intervals = slide_intervals[slide_num]

        # Get the clean title from config, fallback to auto-extracted
        if slide_names_config and slide_num in slide_names_config:
            title = slide_names_config[slide_num]
        else:
            title = slide_data[slide_num].get("title", f"Slide {slide_num}")

        formatted_intervals = []
        raw_intervals = []
        total_duration = 0

        for (start, end) in intervals:
            total_duration += (end - start)
            raw_intervals.append({"start_sec": start, "end_sec": end})

            start_str = f"{start//60:02d}:{start%60:02d}"
            end_str = f"{end//60:02d}:{end%60:02d}"

            if start == end:
                formatted_intervals.append(f"{start_str}")
            else:
                formatted_intervals.append(f"{start_str} to {end_str}")

        json_output["slides"].append({
            "slide_number": slide_num,
            "title": title,
            "is_shown": len(intervals) > 0,
            "total_duration_seconds": total_duration,
            "rushed_warning": (total_duration > 0 and total_duration < 20),
            "intervals_formatted": formatted_intervals,
            "intervals_raw": raw_intervals
        })

    with open(output_path, "w") as f:
        json.dump(json_output, f, indent=4)

    print(f"Report successfully saved to {output_path}")
    return json_output


if __name__ == "__main__":
    # --- Configuration ---
    WORKSPACE = os.environ.get("WORKSPACE_DIR", str(Path(__file__).resolve().parent.parent))
    PDF_PATH = os.path.join(WORKSPACE, "storage", "reference_slides", "Kalvium_ B.Tech CSE to excel in career & life AY27.pdf")
    SLIDES_DIR = os.path.join(WORKSPACE, "storage", "reference_slides", "images")

    # Actual large video file in storage
    VIDEO_PATH = os.path.join(WORKSPACE, "storage", "KALVIUM 1_1 Counselling Session –  Ronmcklein _9962665656 - 2026_09_26 19_27 IST – Recording.mp4")

    print("--- Phase 1: Processing Master Slides ---")
    slide_data = extract_slides_from_pdf(PDF_PATH, SLIDES_DIR)

    print("\n--- Phase 2: Analyzing Video (with Facial Analytics) ---")
    timeline, face_timeline, facial = analyze_video(VIDEO_PATH, slide_data, interval_seconds=10,
                                                    associate_name=os.environ.get("ASSOCIATE_NAME"))

    clean_slide_names = {
        18: "Placement Statistics & Outcomes",
        29: "Where Students Are Placed",
        40: "Why Kalvium (Key Differentiators)",
        63: "Curriculum & Methodology Overview",
        112: "Detailed Fee Structure & Options"
    }

    json_report_path = VIDEO_PATH + "_timeline.json"
    generate_report(timeline, face_timeline, slide_data, slide_names_config=clean_slide_names, debounce_sec=5,
                    facial=facial, output_path=json_report_path)

    print("\nSetup complete! Pillars 1 and 2 are fully active, outputting structured JSON.")
