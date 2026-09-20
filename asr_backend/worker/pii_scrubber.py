from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

# Initialize the engines globally to save load time
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

def scrub_pii(text: str) -> str:
    """
    Scans the given text for PII (Names, Phone Numbers, Email Addresses)
    and replaces them with generic placeholders before sending to external APIs.
    """
    if not text:
        return text
        
    # We only target specific high-risk entities
    results = analyzer.analyze(
        text=text,
        entities=["PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS"],
        language="en"
    )
    
    anonymized_result = anonymizer.anonymize(text=text, analyzer_results=results)
    return anonymized_result.text
