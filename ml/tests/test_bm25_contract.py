"""fixtures/bm25.json must be what hedge.contract writes today.

The JavaScript retriever is tested against the same file (app/test/bm25.test.js), so a
stale fixture would let the two retrievers drift apart without either suite failing.
"""

import json
import math

from hedge.contract import PATH, contract
from hedge.window import RETRIEVER


def same(a, b) -> bool:
    """Equal, with floats allowed to differ by round-off."""
    if isinstance(a, float) or isinstance(b, float):
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-15)
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(map(same, a, b))
    return a == b


def test_fixture_is_current():
    # Up to round-off: libm's exp and log differ in the last bit across platforms, and the
    # JavaScript side already compares scores with a 1e-9 tolerance.
    assert same(json.loads(PATH.read_text(encoding="utf-8")), contract()), "run: python -m hedge.contract"


def test_fixture_check_still_catches_real_changes():
    c = contract()
    changed = json.loads(json.dumps(c))
    changed["cases"][0]["expected"]["scores"][0] += 1e-6
    assert not same(changed, c)


def test_fixture_names_the_retriever_it_defines():
    assert contract()["retriever"] == RETRIEVER


def test_cases_cover_the_rules_that_are_easy_to_port_wrong():
    names = " ".join(c["name"] for c in contract()["cases"])
    for rule in ("stripped", "ties", "unicode", "code point", "repeated", "dotted", "empty window"):
        assert rule in names
