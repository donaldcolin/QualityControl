"""
IndicTrans2 translation wrapper.

Loads the distilled 200M Indic→English model on first call, keeps it in memory.
Protects proper nouns from the entity list by substituting placeholders before
translation and restoring them after.
"""

import re
import logging
import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
from IndicTransToolkit import IndicProcessor

from translation.entities import PROTECTED_ENTITIES

logger = logging.getLogger("translator")

# ── Language code mapping (pipeline 2-letter → FLORES-200) ──────────────────

LANG_CODE_MAP = {
    "hi": "hin_Deva",
    "ta": "tam_Taml",
    "kn": "kan_Knda",
    "te": "tel_Telu",
    "ml": "mal_Mlym",
}

TARGET_LANG = "eng_Latn"
MODEL_NAME = "ai4bharat/indictrans2-indic-en-dist-200M"

# ── Resolve local snapshot path so we NEVER hit the network ─────────────────
import os as _os
_SNAPSHOT_DIR = _os.path.expanduser(
    "~/.cache/huggingface/hub/models--ai4bharat--indictrans2-indic-en-dist-200M"
    "/snapshots/eb9e49d81077cfc5311e82ff36d8c1fc11557b5d"
)

# ── Singleton model holder ──────────────────────────────────────────────────

_model = None
_tokenizer = None
_processor = None
_device = None


def _get_device():
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _ensure_loaded():
    """Lazy-load model, tokenizer, and processor on first call."""
    global _model, _tokenizer, _processor, _device

    if _model is not None:
        return

    logger.info(f"Loading translation model from local cache: {_SNAPSHOT_DIR}")
    _device = _get_device()

    _tokenizer = AutoTokenizer.from_pretrained(
        _SNAPSHOT_DIR,
        trust_remote_code=True,
        local_files_only=True,
    )
    _model = AutoModelForSeq2SeqLM.from_pretrained(
        _SNAPSHOT_DIR,
        trust_remote_code=True,
        local_files_only=True,
        torch_dtype=torch.float16,
    ).to(_device)
    _model.eval()

    _processor = IndicProcessor(inference=True)
    logger.info(f"Translation model loaded on {_device}")


# ── Entity protection ──────────────────────────────────────────────────────

def _protect_entities(sentences: list[str]) -> tuple[list[str], list[dict[str, str]]]:
    """
    Replace known entity names with __ENT_N__ placeholders.
    Returns modified sentences and a per-sentence mapping for restoration.
    """
    all_mappings = []
    protected = []

    for sentence in sentences:
        mapping = {}
        counter = 0
        for entity in PROTECTED_ENTITIES:
            if entity in sentence:
                placeholder = f"__ENT_{counter}__"
                mapping[placeholder] = entity
                sentence = sentence.replace(entity, placeholder)
                counter += 1
        protected.append(sentence)
        all_mappings.append(mapping)

    return protected, all_mappings


def _restore_entities(translations: list[str], mappings: list[dict[str, str]]) -> list[str]:
    """Substitute placeholders back with original entity names."""
    restored = []
    for text, mapping in zip(translations, mappings):
        for placeholder, entity in mapping.items():
            # The model's tokenizer often adds spaces, e.g. "__ENT_0__" -> "_ _ ENT _ 0 _ _"
            # We build a regex that matches the placeholder with optional spaces between characters.
            pattern_str = r'\s*'.join(re.escape(char) for char in placeholder)
            text = re.sub(pattern_str, entity, text, flags=re.IGNORECASE)
        restored.append(text)
    return restored


# ── Public API ──────────────────────────────────────────────────────────────

def translate_batch(sentences: list[str], src_lang: str) -> list[str]:
    """
    Translate a batch of sentences from an Indic language to English.

    Args:
        sentences: List of strings in the source language.
        src_lang:  2-letter language code (hi, ta, kn, te, ml).

    Returns:
        List of English translations, same length as input.
    """
    if not sentences:
        return []

    _ensure_loaded()

    flores_src = LANG_CODE_MAP.get(src_lang)
    if not flores_src:
        raise ValueError(f"Unsupported source language: {src_lang}. "
                         f"Supported: {list(LANG_CODE_MAP.keys())}")

    # Protect proper nouns
    protected_sentences, entity_mappings = _protect_entities(sentences)

    # Process in smaller chunks to avoid CPU memory blowup and massive slowdowns
    # Batch process
    CHUNK_SIZE = 8
    translations = []
    
    for i in range(0, len(protected_sentences), CHUNK_SIZE):
        chunk = protected_sentences[i:i + CHUNK_SIZE]
        logger.info(f"Translating chunk {i//CHUNK_SIZE + 1}/{(len(protected_sentences)-1)//CHUNK_SIZE + 1}...")
        
        # Preprocess
        batch = _processor.preprocess_batch(
            chunk, src_lang=flores_src, tgt_lang=TARGET_LANG
        )

        # Tokenize
        inputs = _tokenizer(
            batch,
            truncation=True,
            padding="longest",
            return_tensors="pt",
            return_attention_mask=True,
        ).to(_device)

        # Generate
        with torch.inference_mode():
            generated = _model.generate(
                **inputs,
                use_cache=False,
                min_length=0,
                max_length=256,
                num_beams=2,
                num_return_sequences=1,
            )

        # Decode
        with _tokenizer.as_target_tokenizer():
            decoded = _tokenizer.batch_decode(
                generated.detach().cpu().tolist(),
                skip_special_tokens=True,
            )

        # Postprocess
        chunk_translations = _processor.postprocess_batch(decoded, lang=TARGET_LANG)
        translations.extend(chunk_translations)

    # Restore entity names
    translations = _restore_entities(translations, entity_mappings)

    import gc
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    elif torch.cuda.is_available():
        torch.cuda.empty_cache()

    logger.info(f"translate_batch complete — {len(translations)} sentences returned")
    return translations
