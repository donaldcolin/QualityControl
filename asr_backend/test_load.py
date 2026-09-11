import os
from pathlib import Path
os.environ["HF_HUB_CACHE"] = str(Path(__file__).parent / "local_models")
os.environ["HF_HUB_OFFLINE"] = "1"

from transformers import AutoModel
print("Loading model offline...")
try:
    model = AutoModel.from_pretrained("ai4bharat/indic-conformer-600m-multilingual", trust_remote_code=True)
    print("Success!")
except Exception as e:
    print(f"Failed: {e}")
