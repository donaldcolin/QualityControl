"""
Translation microservice — IndicTrans2 Indic→English.

Runs on port 8001, separate from the ASR worker (port 8000).
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import logging

import translator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("translation_service")

app = FastAPI(title="IndicTrans2 Translation Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranslateRequest(BaseModel):
    sentences: list[str]
    src_lang: str  # 2-letter code: hi, ta, kn, te, ml


class TranslateResponse(BaseModel):
    translations: list[str]


@app.post("/api/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    """Translate a batch of Indic-language sentences to English."""
    try:
        results = translator.translate_batch(req.sentences, req.src_lang)
        return TranslateResponse(translations=results)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Translation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "translation"}
