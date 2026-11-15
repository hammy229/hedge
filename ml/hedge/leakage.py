"""Keep answers out of model inputs and keep test tickets out of training.

Two leaks inflate duplicate-detection numbers on public Jira data:

1. The text names the answer. Comments and descriptions say "duplicate of HADOOP-1234",
   or paste the other issue's key or URL. ``strip_answer_text`` removes those.
2. The same ticket appears on both sides of a split, because people file the same bug
   twice with copy-pasted text. ``cross_split_duplicates`` finds those pairs so they can be
   dropped from the test side.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Sequence

ISSUE_KEY = re.compile(r"\b[A-Z][A-Z0-9_]{1,19}-\d+\b")
ISSUE_URL = re.compile(r"https?://\S+/(?:browse|jira/browse|issues)/\S+", re.IGNORECASE)
DUPLICATE_PHRASE = re.compile(
    r"\b(?:(?:is\s+)?(?:a\s+)?dup(?:e|licate)?s?(?:d)?\s+(?:of|by)|closing\s+as\s+(?:a\s+)?dup(?:e|licate)?)\b",
    re.IGNORECASE,
)


def strip_answer_text(text: str) -> str:
    """Remove issue URLs, issue keys and 'duplicate of' phrasing, then tidy whitespace."""
    text = ISSUE_URL.sub(" ", text)
    text = ISSUE_KEY.sub(" ", text)
    text = DUPLICATE_PHRASE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize(text: str) -> str:
    """Lowercase, drop issue keys and punctuation, collapse whitespace."""
    text = ISSUE_KEY.sub(" ", text).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _fingerprint(text: str) -> str:
    return hashlib.sha1(normalize(text).encode()).hexdigest()


def cross_split_duplicates(
    train_texts: Iterable[str], test_texts: Sequence[str]
) -> list[int]:
    """Indices of test texts whose normalized form also appears in the training texts.

    Empty texts are ignored: an empty description is not evidence of a copy.
    """
    seen = {_fingerprint(t) for t in train_texts if normalize(t)}
    return [i for i, t in enumerate(test_texts) if normalize(t) and _fingerprint(t) in seen]
