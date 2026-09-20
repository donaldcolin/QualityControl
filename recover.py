import json
import re

transcript_path = "/Users/donaldcolin/.gemini/antigravity-ide/brain/89456369-2de2-4d6d-89f9-56fdbc368259/.system_generated/logs/transcript_full.jsonl"
part1 = ""
part2 = ""

with open(transcript_path, 'r') as f:
    for line in f:
        try:
            data = json.loads(line)
            if "tool_calls" in data:
                continue
            if "type" in data and data["type"] == "TOOL_RESPONSE":
                content = data.get("content", "")
                if "Showing lines 1 to 773" in content and "Content truncated: showing bytes 0-46080" in content:
                    part1 = content
                elif "Showing lines 1 to 773" in content and "ContentOffset=46080" not in content and "Content truncated" not in content:
                    part2 = content
        except Exception:
            pass

# Clean up part1 and part2 to extract only the original lines
def extract_lines(text):
    out = []
    lines = text.split("\n")
    start = False
    for line in lines:
        if line.startswith("The following code has been modified"):
            start = True
            continue
        if start:
            if line.startswith("The above content"):
                break
            # Remove the line number prefix (e.g. "1: ")
            match = re.match(r'^\d+: (.*)$', line)
            if match:
                out.append(match.group(1))
            elif re.match(r'^\d+:$', line):
                out.append("")
    return "\n".join(out)

text1 = extract_lines(part1)
text2 = extract_lines(part2)

with open("/Users/donaldcolin/Developer/Quality Control/recovered_v3.md", "w") as f:
    f.write(text1)
    if text1 and not text1.endswith("\n"):
        f.write("\n")
    f.write(text2)

print("Recovered text written to recovered_v3.md")
