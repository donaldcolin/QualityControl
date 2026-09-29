import os
from huggingface_hub import snapshot_download

token = "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"
cache_dir = "./local_models"

print("Downloading SpeechBrain ECAPA-TDNN...")
snapshot_download(repo_id="speechbrain/spkrec-ecapa-voxceleb", cache_dir=cache_dir, token=token)

print("Downloading Silero VAD (via torch.hub)...")
import torch
torch.hub.load(repo_or_dir='snakers4/silero-vad', model='silero_vad', force_reload=True)

print("All models downloaded!")
