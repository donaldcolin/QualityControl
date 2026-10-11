import re

# Pre-compile regex patterns for maximum performance
# 1. Credit Cards (13-16 digits, with optional spaces or dashes)
CREDIT_CARD_REGEX = re.compile(r"\b(?:\d[\s-]*?){13,16}\b")

# 2. Indian Aadhaar Numbers (12 digits: 4-4-4, not starting with 0 or 1)
AADHAAR_REGEX = re.compile(r"\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b")

# 3. Indian PAN Card Numbers (5 uppercase letters, 4 digits, 1 uppercase letter)
PAN_REGEX = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")

# 4. Indian Phone Numbers (10 digits starting with 6-9, optional +91 or 0 prefix, supporting spaces/hyphens)
PHONE_REGEX = re.compile(r"(?:\+?91[\s-]?|0[\s-]?)?[6789](?:[\s-]?\d){9}\b")

# 5. Spoken digit sequences in English and Hindi (7+ consecutive spoken number words)
SPOKEN_DIGITS_REGEX = re.compile(
    r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ek|do|teen|chaar|char|paanch|panch|chhah|chhe|saat|sat|aath|ath|nau|no|shunya)"
    r"(?:\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|ek|do|teen|chaar|char|paanch|panch|chhah|chhe|saat|sat|aath|ath|nau|no|shunya)){6,}\b",
    re.IGNORECASE
)

# 6. Standard Email Addresses
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")


def scrub_pii(text: str) -> str:
    """
    Ultra-fast PII scrubber using pure Regex.
    Replaces high-risk financial, identity, and contact data with generic placeholders in < 1ms.
    """
    if not text:
        return text

    # Replace Credit Cards first (13-16 digits)
    text = CREDIT_CARD_REGEX.sub("[CREDIT_CARD]", text)

    # Replace Aadhaar (12 digits)
    text = AADHAAR_REGEX.sub("[AADHAAR_NUMBER]", text)

    # Replace PAN cards (ABCDE1234F)
    text = PAN_REGEX.sub("[PAN_CARD]", text)

    # Replace Phones (10 digits, spaced/hyphenated)
    text = PHONE_REGEX.sub("[PHONE_NUMBER]", text)

    # Replace Spoken Digit Chains (English/Hindi)
    text = SPOKEN_DIGITS_REGEX.sub("[PHONE_NUMBER]", text)

    # Replace Emails
    text = EMAIL_REGEX.sub("[EMAIL_ADDRESS]", text)

    return text
