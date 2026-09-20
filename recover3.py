import json
import re

transcript_path = "/Users/donaldcolin/.gemini/antigravity-ide/brain/89456369-2de2-4d6d-89f9-56fdbc368259/.system_generated/logs/transcript_full.jsonl"
target_string = "# Quality Control Automation Platform"

part1 = ""
part2 = ""

with open(transcript_path, 'r') as f:
    for line in f:
        try:
            data = json.loads(line)
            content = data.get("content", "")
            if target_string in content and "The following code has been modified to include a line number" in content:
                if "Content truncated: showing bytes 0-46080" in content:
                    part1 = content
                elif "ContentOffset=46080" not in content and "Content truncated" not in content:
                    part2 = content
        except Exception:
            pass

def clean(text):
    out = []
    start = False
    for line in text.split("\n"):
        if line.startswith("The following code has been modified"):
            start = True
            continue
        if start:
            if line.startswith("The above content") or line.startswith("Content truncated"):
                break
            match = re.match(r'^\d+: (.*)$', line)
            if match:
                out.append(match.group(1))
            elif re.match(r'^\d+:$', line):
                out.append("")
    return out

out1 = clean(part1)
out2 = clean(part2)

full_text = "\n".join(out1)
if out2:
    full_text += "\n" + "\n".join(out2)

with open("/Users/donaldcolin/Developer/Quality Control/recovered_v3_full.md", "w") as f:
    f.write(full_text)

print(f"Part 1 lines: {len(out1)}")
print(f"Part 2 lines: {len(out2)}")
print(f"Total lines: {len(out1) + len(out2)}")
