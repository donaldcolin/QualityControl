import os
import io
import argparse
import json
import re
from pathlib import Path
from dotenv import load_dotenv

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from asr.asr_pipeline import load_model, pick_device, process_file

load_dotenv()
HF_TOKEN = os.getenv("HF_TOKEN")
CREDENTIALS_PATH = "../node_backend/config/credentials.json"
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

def extract_file_id(url):
    """Extracts the file ID from a Google Drive URL."""
    match = re.search(r"/d/([a-zA-Z0-9_-]+)", url)
    if match:
        return match.group(1)
    match = re.search(r"id=([a-zA-Z0-9_-]+)", url)
    if match:
        return match.group(1)
    return url  # Assume the URL is the ID itself if no pattern matches

def download_drive_file(drive_service, file_id, local_path):
    """Downloads a file from Google Drive."""
    print(f"  ⬇️  Downloading file ID: {file_id}...")
    request = drive_service.files().get_media(fileId=file_id)
    
    # Get file metadata to get the original filename if possible
    try:
        file_metadata = drive_service.files().get(fileId=file_id, fields='name').execute()
        original_name = file_metadata.get('name', f"{file_id}.mp3")
        # Sanitize filename (replace slashes to avoid directory path errors)
        original_name = original_name.replace("/", "_").replace("\\", "_")
        # Ensure it has an audio extension so torchaudio can guess the format
        if not original_name.lower().endswith(('.mp3', '.wav', '.m4a')):
            original_name += ".mp3"
    except Exception as e:
        print(f"  ⚠️  Could not fetch metadata for {file_id}: {e}")
        original_name = f"{file_id}.mp3"

    # Save to local path
    fh = io.FileIO(local_path, 'wb')
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while done is False:
        status, done = downloader.next_chunk()
        print(f"      Download {int(status.progress() * 100)}%.")
    fh.close()
    return original_name

def main():
    parser = argparse.ArgumentParser(description="Process Google Drive demo links using ASR pipeline.")
    parser.add_argument("links", nargs="+", help="Google Drive URLs or file IDs to process")
    parser.add_argument("--lang", default="hi", choices=["hi", "ta", "kn", "te", "ml"], help="Language code (default: hi)")
    parser.add_argument("--out", default="../storage", help="Output directory for the transcripts")
    parser.add_argument("--call-type", default="google_meet", choices=["phone", "google_meet"], help="Call type (default: google_meet)")
    parser.add_argument("--num-speakers", default="auto", help="Number of speakers (e.g. 2, 3) or 'auto' for dynamic clustering (default: auto)")
    args = parser.parse_args()

    # Authenticate with Google Drive
    creds_path = os.path.abspath(CREDENTIALS_PATH)
    if not os.path.exists(creds_path):
        print(f"❌ Error: Credentials file not found at {creds_path}")
        return

    print("Authenticating with Google Drive...")
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    drive_service = build('drive', 'v3', credentials=creds)

    # Load ASR Model
    print("Loading ASR model...")
    device = pick_device()
    model, device = load_model(device)

    out_dir = Path(args.out)
    os.makedirs("tmp_audio", exist_ok=True)

    for link in args.links:
        file_id = extract_file_id(link)
        print(f"\nProcessing link: {link} (ID: {file_id})")
        
        local_path = f"tmp_audio/{file_id}.mp3"
        try:
            # Download file
            original_name = download_drive_file(drive_service, file_id, local_path)
            
            # Process with ASR pipeline
            print(f"  🎙️  Transcribing {original_name} (Type: {args.call_type}, Speakers: {args.num_speakers})...")
            
            # Use original name for the final output
            # We rename the local path temporarily so the pipeline uses the correct file name in output
            temp_local_path = f"tmp_audio/{original_name}"
            if os.path.exists(local_path):
                os.rename(local_path, temp_local_path)
            
            result = process_file(
                model=model,
                device=device,
                audio_path=Path(temp_local_path),
                lang=args.lang,
                hf_token=HF_TOKEN,
                out_dir=out_dir,
                status_callback=print,
                call_type=args.call_type,
                num_speakers=args.num_speakers
            )
            
            # Cleanup
            if os.path.exists(temp_local_path):
                os.remove(temp_local_path)
                
            print(f"✅ Finished processing {original_name}")
            
        except Exception as e:
            print(f"❌ Error processing {link}: {e}")
            if os.path.exists(local_path):
                os.remove(local_path)

    print(f"\nAll done! Transcripts are saved in {out_dir}")

if __name__ == "__main__":
    main()
