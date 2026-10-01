import json
import requests
import os
from pathlib import Path
from asr.asr_pipeline import load_model, pick_device, process_file
from dotenv import load_dotenv

load_dotenv()
HF_TOKEN = os.getenv("HF_TOKEN")

def download_file(url, local_path):
    if not os.path.exists(local_path):
        print(f"  ⬇️  Downloading {url}...")
        r = requests.get(url, stream=True)
        with open(local_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
    return local_path

def main():
    print("Loading ASR model...")
    device = pick_device()
    model = load_model(device)
    
    # Read the JSON generated from the CSV
    with open("../node_backend/leads_to_transcribe.json", "r") as f:
        leads = json.load(f)
    
    os.makedirs("tmp_audio", exist_ok=True)
    os.makedirs("tmp_output", exist_ok=True)
    
    print(f"Found {len(leads)} leads to process.")
    
    for lead in leads:
        print(f"\nProcessing Lead {lead['lead_number']} - {lead['name']} ({lead['state']})")
        
        transcripts = []
        for idx, audio_url in enumerate(lead.get('transcribed_calls', [])):
            try:
                ext = audio_url.split('.')[-1][:3]
                local_path = f"tmp_audio/{lead['lead_number']}_call_{idx}.{ext}"
                download_file(audio_url, local_path)
                
                print(f"  🎙️  Transcribing Call {idx + 1}...")
                
                # Map state to indic language code (fallback to 'hi' or 'en')
                state_lang_map = {
                    "tamil-nadu": "ta",
                    "karnataka": "kn",
                    "kerala": "ml",
                    "andhra-pradesh": "te",
                    "telangana": "te",
                    "maharashtra": "hi",
                    "west-bengal": "hi"
                }
                lang_code = state_lang_map.get(lead['state'].lower(), "hi")
                print(f"      using language model: {lang_code}")
                
                result = process_file(
                    model=model,
                    device=device,
                    audio_path=Path(local_path),
                    lang=lang_code,  
                    hf_token=HF_TOKEN,
                    out_dir=Path("tmp_output")
                )
                
                # Combine the segments into a single text block
                full_text = "\n".join([f"{seg['speaker']}: {seg['text']}" for seg in result])
                transcripts.append(full_text)
                
                # Clean up
                os.remove(local_path)
            except Exception as e:
                print(f"  ❌ Error processing {audio_url}: {e}")
                transcripts.append(f"ERROR: {str(e)}")
        
        # Replace the URLs with actual transcripts
        lead['transcribed_calls'] = transcripts
        
        # Save incrementally so we don't lose data if it crashes
        with open("final_transcripts.json", "w") as f:
            json.dump(leads, f, indent=2)

    print("\n✅ Done! Transcripts saved to 'final_transcripts.json'")

if __name__ == "__main__":
    main()
