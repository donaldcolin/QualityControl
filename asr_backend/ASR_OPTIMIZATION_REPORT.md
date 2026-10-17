# ASR Optimization Report (2026-10-17)

Machine: MacBook Air M1 (8 cores, no fan). Language tested: Tamil.
All numbers come from `bench/bench.py` runs or the one-off tests noted below.

## Results at a glance

| | Before | After |
|---|---|---|
| Transcribing a ~10 min call | 90–254 s (2.4x–6.6x real time) | **~35–55 s (11x–17x real time)** |
| Full processing of a 10.5 min phone call | ~4 min | **64 s** (+12 s one-time model load) |
| Phone Agent/Customer labels | **swapped** on both real calls tested | **correct** on both |
| Transcript text | baseline | **identical** (0.00% character difference) |
| Meet demo speaker accuracy (per-second video answer key) | 97.4% / 84.4% | unchanged (already above the 75% target) |

### Benchmark table (10-min clips)

| Clip | Speaker accuracy | Diarization | ASR before → after | Total before → after |
|---|---|---|---|---|
| demoA (Meet, 28–38 min) | 97.4% | ~10 s | 90 s → 55 s | 102 s → 65 s |
| demoB (Meet, 60–70 min) | 84.4% | ~10 s | 134 s → 47 s | 146 s → 60 s |
| phone (Tamil, 10 min) | roles checked by hand | ~10 s | 254 s → 52 s | 266 s → 65 s |
| phone2 (Tamil, 10.5 min, Sudharsan) | roles checked by hand | 12 s | – | 64 s |

ASR "after" in this table is with 4 workers. Moving to 6 workers saves a further ~17%: 43.0 s → 35.1 s on phone2, and 47.6 s → 39.9 s on demoA.

## What changed (all in `asr/asr_pipeline.py`)

1. **Removed the transcription lock (`_model_inference_lock`).**
   - It was added on Oct 11 (commit `32d5362`) and forced the 4 worker threads to take turns, so only one segment was transcribed at a time.
   - IndicConformer runs on ONNX Runtime on the CPU. Its sessions are thread-safe and run in parallel without the lock.
   - Result: 135.6 s → 63.6 s on the same clip, with identical text.
   - The audio now stays on the CPU (`transcription_wav = trimmed_wav.cpu()`), where the model's preprocessor runs anyway. The old GPU copies did nothing.
2. **6 transcription workers instead of 4 (`_CONCURRENT_WORKERS`).** 6 is the best on the M1's 8 cores; 8 is slower.
3. **Phone roles: new `map_phone_roles()`, run after transcription.**
   - Old rule: the first speaker is the Agent. That's wrong on outbound calls, because the customer picks up with "hello" first.
   - New rule:
     - **(a)** On stereo recordings the channel split still decides.
     - **(b)** Otherwise, whoever says the brand ("Kalvium", in Tamil, Hindi, Kannada, Telugu, Malayalam and English) most is the Agent.
     - **(c)** If nobody says it, or it's a tie, whoever talks the most is the Agent.
   - "கல்வியல்" (Tamil for "education") is deliberately not counted as the brand.
   - The rule that decided is saved as `role_assignment_method` (`brand_mention` / `talk_time` / `channel_metadata`).

## Tried and rejected

| Idea | Result | Why rejected |
|---|---|---|
| Batching several segments into one model call | 45–76 s vs 44 s, with 0.4–1.4% text changes | Slower, and the padding changes the output |
| 8 workers | 52.2 s vs 39.9 s with 6 | The workers fight over the CPU cores |
| CoreML (Apple engine) for the encoder | Not finished: the laptop overheated and the test was stopped | CoreML only supports ~2,013 of 3,270 model operations (317 split partitions), so a speed-up is unlikely |
| 1.5 s windows + agglomerative clustering (diarization) | 49% vs 73% (coarse key) | It put almost everything into one speaker |
| 3 s windows + KMeans (diarization) | 79.7% on one clip, 71.7% on the other (coarse key) | Not consistently better |
| Voices learned from the video for Meet | ~71% on unseen audio (coarse key) | No gain, and the diarizer already passes on the sharp key |
| pyannote | – | Accurate but too slow (user's own experience) |

The earlier "63%" speaker figure used a coarse 10-second answer key. With the sharp per-second key, today's diarizer scores 97.4% / 84.4%, so it was left unchanged.

## Known limits
- **Speaker accuracy answer key:** it comes from the Meet video's active-speaker tile (name-label OCR, per second), not from a human. It's only available for Meet demos.
- **Phone roles:** checked by hand on only 2 real Tamil calls. They're the only phone calls available, and only one is stored in the database.
- **Earlier phone calls:** calls processed before this change may have Agent and Customer swapped. Re-process them if their QC scores matter.
- **Rough transcript wording:** comes from the IndicConformer model itself, and none of these changes touch it.
- **Heat:** the M1 Air slows itself down when hot. If a long queue makes it too hot, set `_CONCURRENT_WORKERS` back to 4.

## How to re-run the benchmark
```bash
cd asr_backend
venv/bin/python bench/bench.py prepare        # once: builds storage/bench/ clips + per-second answer keys
venv/bin/python bench/bench.py run            # after a change: accuracy, speed, CER vs reference
venv/bin/python bench/bench.py run --save-ref # only when you accept the new output as the reference
```
A run takes about 3–4 minutes for the 3 clips. On the Air, run it with nothing else heavy open.
