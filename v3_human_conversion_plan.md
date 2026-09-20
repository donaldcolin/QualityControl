# Goal
Convert `QC_Platform_v3.md` from a dry, purely technical spec into a "humanly written," narrative-driven document while maintaining all 35+ critical technical fixes.

## Strategy
1. **Change the Tone:** Move away from terse bullet points and cold tables where possible. Use a conversational, explanatory tone that tells the *story* of the architecture—why decisions were made, the pitfalls we're avoiding, and how the system behaves in real-world scenarios.
2. **Contextualize the Fixes:** Instead of just listing the technical fix (e.g., `SELECT FOR UPDATE SKIP LOCKED`), explain *why* it's there (e.g., "Imagine two workers waking up at the exact same millisecond and trying to grab the same call...").
3. **Restructure for Readability:** Break up massive code blocks or schemas with narrative explanations. Use analogies where appropriate (like the "Outbox Pattern" as a mailroom).
4. **Maintain Precision:** Do NOT lose the strict technical requirements (e.g., the constraints, the exact column names, the specific model migration checklist). The document must still function as an architectural source of truth, just a much more readable one.

## Proposed Changes (Targeting `QC_Platform_v3.md`)

*   **Introduction:** Rewrite to set the stage. Acknowledge the journey from v2, the senior review feedback, and the overarching goal of building a robust, production-ready system.
*   **System Architecture (The "Bird's Eye View"):** Introduce the components as actors in a play. Describe the flow of a call from ingestion to evaluation as a narrative.
*   **The Database (The Coordinator):** Explain *why* PostgreSQL is the heart of the system. Discuss the shift to atomic locking and append-only logs in conversational terms.
*   **The ASR Worker (The Heavy Lifter):** Describe the audio processing pipeline (ASR -> Diarisation -> Role Mapping -> Translation) as an assembly line, emphasizing the new safety checks (like halting on translation failure).
*   **The Node.js Engine (The Evaluator):** Explain the interaction with the Gemini Batch API. Describe the prompt construction and the new immutable rubric caching.
*   **Security & Operations:** Frame these sections not just as checklists, but as essential safeguards (SSRF protection, PII redaction, prompt injection defence) protecting the business.

## Execution
I will rewrite the document in chunks, using the `replace_file_content` or `multi_replace_file_content` tools, completely transforming the text while preserving the technical architecture.
