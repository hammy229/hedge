"""Write fixtures/bm25.json: retrieval cases the Python and JavaScript retrievers must agree on.

The threshold is certified on scores from ``hedge.window``. The Forge app computes them
with app/src/bm25.js and app/src/text.js. Each case gives a window of earlier issues and a
new ticket, and records the retrieval texts, every window score, the top candidates and
the score features. ml/tests/test_bm25_contract.py checks the file is current, and
app/test/bm25.test.js checks the JavaScript side against it.

    python -m hedge.contract   # after changing a definition, then bump RETRIEVER
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .corpus import MAX_DESCRIPTION, retrieval_parts
from .features import score_features
from .window import B, K, K1, RETRIEVER, WINDOW, TokenIndex, top_k, window_scores

PATH = Path(__file__).resolve().parents[2] / "fixtures" / "bm25.json"
PROJECT_KEYS = ["HADOOP", "MC", "SPARK"]


def _issue(summary, description=""):
    return {"summary": summary, "description": description}


CASES = [
    ("clear duplicate", _issue("NPE in FileSystem.open when path is null"), [
        _issue("FileSystem.open throws NPE for a null path", "Stack trace below"),
        _issue("Dark mode colors are wrong"),
        _issue("Upgrade to Java 21"),
    ]),
    ("answer text is stripped before scoring", _issue("Crash on login, duplicate of HADOOP-12", "see hadoop-12"), [
        _issue("HADOOP-12 login crash", "https://issues.apache.org/jira/browse/HADOOP-12"),
        _issue("login page is slow"),
    ]),
    ("standards and unknown lowercase keys stay", _issue("UTF-8 names break python-3 builds", "SHA-256 mismatch"), [
        _issue("python-3 build fails on UTF-8 file names"),
        _issue("SHA-256 checksum mismatch in release"),
    ]),
    ("exact ties go to the older issue", _issue("cache leak"), [
        _issue("cache leak"),
        _issue("cache leak"),
        _issue("thread deadlock"),
    ]),
    ("no shared terms returns nothing", _issue("zzz qqq"), [_issue("alpha beta"), _issue("gamma")]),
    ("empty window", _issue("anything at all"), []),
    ("unicode letters next to keys and non-ASCII digits", _issue("éHADOOP-1 and HADOOP-١٢ fail", "Grüße"), [
        _issue("HADOOP fail grüße"),
        _issue("unrelated"),
    ]),
    # 600 emoji are 600 code points but 1,200 UTF-16 units: a cut by UTF-16 length would
    # drop "tailword", a cut by code points keeps it, and the 1,500-emoji doc loses it.
    ("descriptions are cut at the same code point", _issue("emoji crash tailword"), [
        _issue("emoji crash", "😀" * 600 + " tailword"),
        _issue("emoji", "😀" * 1500 + " tailword"),
        _issue("tailword"),
    ]),
    ("repeated query terms count more", _issue("render render render ui"), [
        _issue("render loop"),
        _issue("ui ui ui widget"),
    ]),
    ("dotted and underscored names are single tokens", _issue("max_len breaks FileSystem.open"), [
        _issue("max len breaks file system open"),
        _issue("max_len and FileSystem.open"),
    ]),
]


def case(name: str, query: dict, window: list[dict]) -> dict:
    keys = frozenset(PROJECT_KEYS)
    texts = []
    for doc in [*window, query]:
        s, d = retrieval_parts(doc["summary"], doc["description"], keys)
        texts.append(s + "\n" + d)
    index = TokenIndex.build(texts)
    scores = window_scores(index, 0, len(window), index.query(texts[-1]))
    top = top_k(scores, K)
    return {
        "name": name,
        "query": query,
        "window": window,
        "expected": {
            "texts": texts,
            "scores": scores.tolist(),
            "top": top.tolist(),
            "features": score_features(scores[top], K),
        },
    }


def contract() -> dict:
    return {
        "about": "Shared retrieval cases, written by python -m hedge.contract and read by "
        "ml/tests/test_bm25_contract.py and app/test/bm25.test.js.",
        "retriever": RETRIEVER,
        "window": WINDOW,
        "k": K,
        "k1": K1,
        "b": B,
        "maxDescription": MAX_DESCRIPTION,
        "projectKeys": PROJECT_KEYS,
        "cases": [case(*c) for c in CASES],
    }


def render() -> str:
    return json.dumps(contract(), indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    PATH.write_text(render(), encoding="utf-8")
    print(f"wrote {PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
