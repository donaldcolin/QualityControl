import os
from huggingface_hub import snapshot_download

token = "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"
cache_dir = "./local_models"

print("Downloading Pyannote Diarization...")
snapshot_download(repo_id="pyannote/speaker-diarization-3.1", cache_dir=cache_dir, token=token)
snapshot_download(repo_id="pyannote/segmentation-3.0", cache_dir=cache_dir, token=token)
snapshot_download(repo_id="pyannote/wespeaker-voxceleb-resnet34-LM", cache_dir=cache_dir, token=token)

print("All models downloaded to ./local_models!")
