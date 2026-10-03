import csv
import json
import requests
import os
import torchaudio
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
    model, device = load_model(device)
    
    leads = []
    with open("../node_backend/curated_leads.csv", "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row or len(row) < 7:
                continue
            
            lead_id = row[0]
            name = f"{row[1]} {row[2]}".strip()
            language = row[6].strip()
            
            # audio links start at index 7
            audio_links = [link.strip() for link in row[7:] if link.strip().startswith("http")]
            
            if audio_links:
                leads.append({
                    "lead_number": lead_id,
                    "name": name,
                    "language": language,
                    "transcribed_calls": audio_links
                })

    os.makedirs("tmp_audio", exist_ok=True)
    os.makedirs("tmp_output", exist_ok=True)
    
    print(f"Found {len(leads)} leads to process.")
    
    for lead in leads:
        print(f"\nProcessing Lead {lead['lead_number']} - {lead['name']} ({lead['language']})")
        
        transcripts = []
        for idx, audio_url in enumerate(lead.get('transcribed_calls', [])):
            try:
                # Handle URLs with query params properly
                ext = audio_url.split('?')[0].split('.')[-1][:3]
                local_path = f"tmp_audio/{lead['lead_number']}_call_{idx}.{ext}"
                download_file(audio_url, local_path)
                
                # Check audio duration
                info = torchaudio.info(local_path)
                duration_sec = info.num_frames / info.sample_rate
                
                if duration_sec < 180:
                    print(f"  ⏭️  Skipping Call {idx + 1} (Duration: {duration_sec/60:.1f} mins, which is less than 3 mins)")
                    os.remove(local_path)
                    continue
                
                print(f"  🎙️  Transcribing Call {idx + 1} ({duration_sec/60:.1f} mins)...")
                
                lang_map = {
                    "Tamil": "ta",
                    "Kannada": "kn",
                    "Malayalam": "ml",
                    "Telugu": "te",
                    "Hindi": "hi"
                }
                lang_code = lang_map.get(lead['language'], "hi")
                print(f"      using language model: {lang_code}")
                
                result = process_file(
                    model=model,
                    device=device,
                    audio_path=Path(local_path),
                    lang=lang_code,  
                    hf_token=HF_TOKEN,
                    out_dir=Path("tmp_output")
                )
                
                full_text = "\n".join([f"{seg['speaker']}: {seg['text']}" for seg in result['speaker_turns']])
                transcripts.append(full_text)
                
                os.remove(local_path)
            except Exception as e:
                print(f"  ❌ Error processing {audio_url}: {e}")
                transcripts.append(f"ERROR: {str(e)}")
        
        lead['transcribed_calls'] = transcripts
        
        with open("final_transcripts_curated.json", "w", encoding="utf-8") as f:
            json.dump(leads, f, indent=2, ensure_ascii=False)

    print("\n✅ Done! Transcripts saved to 'final_transcripts_curated.json'")

if __name__ == "__main__":
    main()
