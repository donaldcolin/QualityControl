import re

# Pre-compile regex patterns for maximum performance
# 1. Indian Phone Numbers (10 digits, optional +91 or 0)
PHONE_REGEX = re.compile(r"(?:\+91[\-\s]?|91[\-\s]?|0[\-\s]?)?[6789]\d{9}")

# 2. Standard Email Addresses
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")

# 3. Credit Cards (14-16 digits, with optional spaces or dashes)
CREDIT_CARD_REGEX = re.compile(r"\b(?:\d[ -]*?){13,16}\b")

def scrub_pii(text: str) -> str:
    """
    Ultra-fast PII scrubber using pure Regex. 
    Replaces high-risk financial and contact data with generic placeholders in < 1ms.
    """
    if not text:
        return text
        
    # Replace Credit Cards first (to avoid phone number overlap)
    text = CREDIT_CARD_REGEX.sub("[CREDIT_CARD]", text)
    
    # Replace Phones
    text = PHONE_REGEX.sub("[PHONE_NUMBER]", text)
    
    # Replace Emails
    text = EMAIL_REGEX.sub("[EMAIL_ADDRESS]", text)
    
    return text
