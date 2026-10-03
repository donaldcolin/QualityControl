import json
import csv
import sys

def main():
    json_path = "final_transcripts_curated.json"
    csv_path = "final_transcripts_curated.csv"
    
    print(f"Loading {json_path}...")
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Could not find {json_path}")
        sys.exit(1)
        
    print(f"Loaded {len(data)} leads.")
    
    # We will create one row per call, so if a lead has 3 calls, 
    # it gets 3 rows. This prevents any data loss and keeps the CSV clean.
    csv_rows = []
    
    for lead in data:
        lead_number = lead.get("lead_number", "")
        name = lead.get("name", "")
        language = lead.get("language", "")
        calls = lead.get("transcribed_calls", [])
        
        for idx, call_transcript in enumerate(calls):
            csv_rows.append({
                "lead_number": lead_number,
                "name": name,
                "language": language,
                "call_index": idx + 1,
                "transcript": call_transcript
            })
            
    print(f"Flattened into {len(csv_rows)} total calls.")
    
    print(f"Writing to {csv_path}...")
    with open(csv_path, 'w', encoding='utf-8', newline='') as f:
        fieldnames = ["lead_number", "name", "language", "call_index", "transcript"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        
        writer.writeheader()
        writer.writerows(csv_rows)
        
    print("✅ Conversion complete! No data lost.")

if __name__ == "__main__":
    main()
