"""fixtures/bm25.json must be what hedge.contract writes today.

The JavaScript retriever is tested against the same file (app/test/bm25.test.js), so a
stale fixture would let the two retrievers drift apart without either suite failing.
"""

from hedge.contract import PATH, contract, render
from hedge.window import RETRIEVER


def test_fixture_is_current():
    assert PATH.read_text(encoding="utf-8") == render(), "run: python -m hedge.contract"


def test_fixture_names_the_retriever_it_defines():
    assert contract()["retriever"] == RETRIEVER


def test_cases_cover_the_rules_that_are_easy_to_port_wrong():
    names = " ".join(c["name"] for c in contract()["cases"])
    for rule in ("stripped", "ties", "unicode", "code point", "repeated", "dotted", "empty window"):
        assert rule in names
