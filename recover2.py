import json

transcript_path = "/Users/donaldcolin/.gemini/antigravity-ide/brain/89456369-2de2-4d6d-89f9-56fdbc368259/.system_generated/logs/transcript_full.jsonl"
longest_text = ""
target_string = "# Quality Control Automation Platform"

with open(transcript_path, 'r') as f:
    for line in f:
        try:
            data = json.loads(line)
            content = data.get("content", "")
            if target_string in content and "The following code has been modified to include a line number" in content:
                # Keep track of the longest matched block (since I viewed the file in chunks)
                if len(content) > len(longest_text):
                    longest_text = content
        except Exception:
            pass

import re
out = []
for line in longest_text.split("\n"):
    if line.startswith("The following code has been modified") or line.startswith("The above content"):
        continue
    if "Total Lines:" in line or "Total Bytes:" in line or "Showing lines" in line or "File Path:" in line or "Content truncated" in line:
        continue
    match = re.match(r'^\d+: (.*)$', line)
    if match:
        out.append(match.group(1))
    elif re.match(r'^\d+:$', line):
        out.append("")

with open("/Users/donaldcolin/Developer/Quality Control/recovered_v3.md", "w") as f:
    f.write("\n".join(out))

print("Found block of length:", len(longest_text))
print("Wrote to recovered_v3.md")
