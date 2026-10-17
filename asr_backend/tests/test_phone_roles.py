"""Phone Agent/Customer mapping. Run: venv/bin/python tests/test_phone_roles.py (pytest-compatible too)."""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from asr.asr_pipeline import map_phone_roles  # noqa: E402


def T(spk, a, b, text):
    return {"speaker": spk, "start": a, "end": b, "text": text}


def roles_of(turns):
    _, roles, method = map_phone_roles(copy.deepcopy(turns))
    return roles, method


def test_brand_beats_talk_time():
    roles, method = roles_of([T("S0", 0, 10, "hi I am calling from Kalvium"), T("S1", 10, 60, "long story about my son")])
    assert roles == {"S0": "Agent", "S1": "Customer"} and method == "brand_mention"


def test_tamil_brand_and_customer_hello_first():
    roles, method = roles_of([T("S1", 0, 2, "ஹலோ ஹலோ"), T("S0", 3, 20, "நான் கல்வியம்ல இருந்து கால் பண்ணியிருக்கேன்")])
    assert roles["S0"] == "Agent" and method == "brand_mention"


def test_no_brand_falls_back_to_talk_time():
    roles, method = roles_of([T("S0", 0, 5, "hello"), T("S1", 5, 60, "so about the course")])
    assert roles["S1"] == "Agent" and method == "talk_time"


def test_brand_tie_falls_back_to_talk_time():
    roles, method = roles_of([T("S0", 0, 5, "kalvium?"), T("S1", 5, 60, "yes kalvium, the course")])
    assert roles["S1"] == "Agent" and method == "talk_time"


def test_tamil_word_for_education_is_not_the_brand():
    roles, method = roles_of([T("S0", 0, 50, "நான் கல்வியல் பற்றி கேட்கிறேன்"), T("S1", 50, 60, "சரி")])
    assert method == "talk_time" and roles["S0"] == "Agent"


if __name__ == "__main__":
    tests = [f for name, f in sorted(globals().items()) if name.startswith("test_")]
    for t in tests:
        t()
        print("PASS", t.__name__)
    print(f"{len(tests)}/{len(tests)} passed")
