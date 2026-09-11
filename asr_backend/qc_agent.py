"""
QC Agent — thin wrapper around the QA_LLm coaching service.

The actual QC evaluation is handled by the QA_LLm service (port 8002).
This module is kept for backward compatibility but the real work
happens via HTTP to the coaching engine.
"""

import logging
import requests

logger = logging.getLogger("qc_agent")
logger.setLevel(logging.INFO)

QA_LLM_URL = "http://localhost:8002/api/qc/evaluate_call"


def run_coaching_evaluation(transcript_text, prospect_id=None, source="phone_call"):
    """
    Send transcript to the QA_LLm coaching service for evaluation.
    Returns the coaching report or a fallback stub if the service is unavailable.
    """
    try:
        resp = requests.post(
            QA_LLM_URL,
            json={
                "transcript": transcript_text,
                "prospect_id": prospect_id,
                "source": source,
            },
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("success") and data.get("coaching_report"):
            report = data["coaching_report"]
            return {
                "rating": report.get("overall_grade", "N/A"),
                "notes": report.get("summary", ""),
                "coaching_report": report,
            }
    except Exception as e:
        logger.warning(f"QA_LLm coaching call failed: {e}")

    # Fallback stub
    return {
        "rating": "Pending",
        "notes": "QC coaching service unavailable — evaluation pending.",
        "coaching_report": None,
    }


# Legacy function kept for backward compatibility
def run_gemini_qc(transcript_segments, language):
    """Legacy stub — redirects to the coaching service."""
    lines = []
    for seg in transcript_segments:
        speaker = seg.get("speaker", "Unknown")
        text = seg.get("text_en") or seg.get("text", "")
        lines.append(f"{speaker}: {text}")
    transcript_text = "\n".join(lines)
    return run_coaching_evaluation(transcript_text)
