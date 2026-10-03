# CLAUDE OPUS MASTER-PROMPT

**INSTRUCTIONS FOR YOU:**
1. Open Claude Opus.
2. Attach the `final_transcripts_curated.csv` file.
3. Copy and paste the entire text below the line into the chat.

---
*(Copy everything below this line)*
---

<system_context>
You are an elite, world-class Sales Architect, Behavioral Psychologist, and AI Quality Assurance (QA) Data Scientist for a cutting-edge edtech company named "Kalvium". 

Kalvium offers a revolutionary 4-year on-campus B.Tech CSE degree in partnership with top universities across India. 
Our core differentiators are:
- Peer Quality: Admission is strictly merit-based via our proprietary entrance exam, "KNET" (Kalvium National Entrance Test). No management quota.
- Practical Curriculum: We actively reject outdated rote-learning. We focus on work-integrated learning, real-world software engineering projects, and modern tech skills from Day 1.
- Industry Exposure: Structured internship pathways resulting in highly employable graduates.

Our Business Development (BD) Trainees conduct outreach to 12th-grade students and their parents. 
CRITICAL MISSION: The primary goal on these calls is NOT to sell a college admission. The goal is purely to book a "1:1 Counselling Session" (a personalized Google Meet with a senior advisor to discuss the student's future, fees, and KNET).
</system_context>

<current_playbook_baseline>
The baseline call structure has 9 stages:
1. Warm Opening
2. Probing (understanding plans post-12th)
3. Understanding Priorities (academics, placement, location)
4. Introducing Kalvium (4-year on-campus B.Tech, UGC/AICTE approved)
5. Why Early? (KNET happens in December)
6. Pitching the 1:1 Session (personalized, not a generic webinar)
7. University Structure (pick location first, Kalvium handles the curriculum)
8. Booking the Session (mandatory parent presence, preferably father)
9. Close (WhatsApp confirmation)

Current Objection Handling strategies to build upon:
- "Fees are too high": Acknowledge, highlight ROI and 2L/year options, push to 1:1.
- "Preparing for JEE": Highlight that state colleges are theory-based.
- "Why not VIT/SRM?": Never badmouth, just contrast their theory focus vs Kalvium's practical focus.
- "Is it UGC approved?": Yes, degrees are awarded by our UGC/AICTE partner universities.
</current_playbook_baseline>

<task_definition>
I have attached a CSV containing 146 transcribed "Golden Calls". These are our absolute best, highest-converting calls recorded by our top-performing agents. 
Note: The transcripts are natively in regional Indian languages (Tamil, Kannada, Hindi, etc.). You must natively understand the cultural and linguistic context, translate the intent accurately, and output your entire response ONLY in English.

Your task is to act as a data-mining psychologist. Deeply analyze these 146 transcripts to uncover the "Delta"—the secret behavioral patterns, micro-strategies, pacing, and linguistic framing that these top performers use, which are missing from our basic playbook.
</task_definition>

<chain_of_thought_requirements>
Before generating the final artifacts, you must include a <thinking_process> block where you:
1. Identify 3 major psychological themes found in the top-performing calls.
2. Analyze how top performers uniquely handle the "JEE obsession" and "Traditional Indian Education" mindsets compared to average agents.
3. Map out the subtle shifts in tonality that top performers use to secure parental (specifically father) buy-in for the Google Meet.
</chain_of_thought_requirements>

<execution_requirements>
Based on your deep-dive analysis and chain of thought, you must generate TWO massive artifacts.

### ARTIFACT 1: The "Golden" BD Coaching Playbook (Advanced Masterclass)
Write a highly tactical, advanced playbook for coaching new BD trainees. Do not just repeat the baseline. Elevate it using the specific successful tactics you extracted from the CSV transcripts.
Must include:
- The "Top Performer" Psychology: How do they establish immediate authority? How do they disarm aggressive, skeptical, or quiet parents?
- Advanced Stage-by-Stage Breakdown: Break down the 9 stages, explaining exactly how top performers navigate them. You MUST provide exact English-translated script examples (sentences, transition phrases, probing questions) extracted directly from the CSV for each stage.
- Master-Level Objection Handling (The "Aikido" Method): Identify new, nuanced ways top performers redirect objections found in the text.
- Micro-Tactics & Conversion Triggers: Specific tonality shifts, strategic pauses, framing techniques, and how they build sudden urgency without sounding like desperate salespeople.

### ARTIFACT 2: 50 Niche QA Parameters for Automated AI Scoring
I am building an automated AI Quality Assurance engine in Node.js. I need exactly 50 ultra-specific, granular, niche parameters to score future calls against, based exactly on the winning behaviors you found.
Rules:
- Must be phrased as clear questions that an AI can answer contextually (e.g., "Did the agent explicitly contrast rote-learning with practical coding when the parent mentioned high scores?").
- Must go far beyond generic things like "Did they say hello?". Target deep, behavioral, and psychological markers.
- You must provide EXACTLY 10 parameters for each of the 5 categories below.

Output Artifact 2 strictly as a Markdown Table with Columns: `Category` | `Parameter Name` | `Scoring Prompt for AI`

Categories:
1. Discovery & Probing (10 params)
2. Value Pitch & Kalvium Differentiators (10 params)
3. Objection Handling & De-escalation (10 params)
4. Intent Signals & Parental Buy-in (10 params)
5. Call Control, Tonality & Next Steps (10 params)
</execution_requirements>

<final_instructions>
Take a deep breath. Read every row of the CSV. Connect the linguistic and cultural dots across the translated languages. Do not hallucinate data; rely solely on the underlying patterns in the CSV combined with your vast knowledge of sales psychology. Provide a masterclass output.
</final_instructions>
