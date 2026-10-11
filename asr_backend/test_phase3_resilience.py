"""
Phase 3 Python Hardening Test Suite
Validates:
1. Extended PII scrubbing (Aadhaar, PAN, spaced phones, spoken digit strings)
2. Python AST/Syntax integrity across all modified worker and ASR files
"""

import sys
import py_compile
from pathlib import Path

# Add asr_backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import worker.pii_scrubber as pii_scrubber


def run_tests():
    print("🧪 Running Phase 3 Python Hardening Test Suite...\n")
    passed = 0
    failed = 0

    def assert_test(name, condition, error_msg=""):
        nonlocal passed, failed
        if condition:
            print(f"  ✅ [PASS] {name}")
            passed += 1
        else:
            print(f"  ❌ [FAIL] {name}: {error_msg}")
            failed += 1

    # ── 1. PII Scrubber Tests ───────────────────────────────────────────────
    print("--- 1. Testing Multilingual PII Scrubber ---")

    # Indian Aadhaar (12 digits)
    aadhaar_sample = "Customer's Aadhaar number is 5432 1098 7654 for verification"
    scrubbed_aadhaar = pii_scrubber.scrub_pii(aadhaar_sample)
    assert_test(
        "Aadhaar 12-digit masking",
        "[AADHAAR_NUMBER]" in scrubbed_aadhaar and "5432 1098 7654" not in scrubbed_aadhaar,
        f"Result: {scrubbed_aadhaar}"
    )

    # Indian PAN Card (ABCDE1234F)
    pan_sample = "Pan card number is ABCDE1234F submitted today"
    scrubbed_pan = pii_scrubber.scrub_pii(pan_sample)
    assert_test(
        "PAN Card masking",
        "[PAN_CARD]" in scrubbed_pan and "ABCDE1234F" not in scrubbed_pan,
        f"Result: {scrubbed_pan}"
    )

    # Spaced / Hyphenated Indian Phone Numbers
    phone_spaced = "You can call me on +91 98765 43210 tomorrow morning"
    scrubbed_phone = pii_scrubber.scrub_pii(phone_spaced)
    assert_test(
        "Spaced Indian Phone masking",
        "[PHONE_NUMBER]" in scrubbed_phone and "98765" not in scrubbed_phone,
        f"Result: {scrubbed_phone}"
    )

    # Spoken Digit Chains (English)
    spoken_en = "My number is nine eight seven six five four three two one zero please note it down"
    scrubbed_spoken_en = pii_scrubber.scrub_pii(spoken_en)
    assert_test(
        "Spoken Digit Chains (English) masking",
        "[PHONE_NUMBER]" in scrubbed_spoken_en,
        f"Result: {scrubbed_spoken_en}"
    )

    # Spoken Digit Chains (Hindi)
    spoken_hi = "Mera number hai nau aath saat chhah paanch chaar teen do ek shunya"
    scrubbed_spoken_hi = pii_scrubber.scrub_pii(spoken_hi)
    assert_test(
        "Spoken Digit Chains (Hindi) masking",
        "[PHONE_NUMBER]" in scrubbed_spoken_hi,
        f"Result: {scrubbed_spoken_hi}"
    )

    # ── 2. Syntax & Compilation Check ───────────────────────────────────────
    print("\n--- 2. Testing Python Syntax & Compilation ---")
    files_to_compile = [
        "worker/pii_scrubber.py",
        "worker/queue_processor.py",
        "api/api_webhook.py",
        "asr/asr_pipeline.py"
    ]

    base_dir = Path(__file__).resolve().parent
    for rel_path in files_to_compile:
        file_path = base_dir / rel_path
        try:
            py_compile.compile(str(file_path), doraise=True)
            assert_test(f"Compilation: {rel_path}", True)
        except Exception as e:
            assert_test(f"Compilation: {rel_path}", False, str(e))

    print(f"\n========================================")
    print(f"Phase 3 Python Results: {passed} passed, {failed} failed")
    print(f"========================================\n")

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_tests()
