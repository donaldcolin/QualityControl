import fitz
import os
WORKSPACE = "/Users/donaldcolin/Developer/Quality Control"
PDF_PATH = os.path.join(WORKSPACE, "storage", "reference_slides", "Kalvium_ B.Tech CSE to excel in career & life AY27.pdf")
doc = fitz.open(PDF_PATH)
for i in range(10):
    text = doc.load_page(i).get_text("text")
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    title = lines[0] if lines else "No Title"
    print(f"Slide {i+1}: {title}")
