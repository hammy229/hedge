"""Keep answers out of model inputs and keep test tickets out of training.

Two leaks inflate duplicate-detection numbers on public Jira data:

1. The text names the answer. Comments and descriptions say "duplicate of HADOOP-1234",
   or paste the other issue's key or URL. ``strip_answer_text`` removes those.
2. The same ticket appears on both sides of a split, because people file the same bug
   twice with copy-pasted text. ``cross_split_duplicates`` finds those pairs so they can be
   dropped from the evaluated side.

Functions that look for issue keys take optional ``project_keys``: the dataset's real
project keys. Without them only uppercase keys match, because lowercase "python-3" or
"java-8" is ordinary text. With them, lowercase forms of those keys ("hadoop-1234", common
in pasted URLs and casual comments) match too.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Sequence
from functools import lru_cache

# Uppercase-dash-number tokens that are standards or algorithms, not Jira issues. Stripping
# "UTF-8" or "SHA-256" would delete real signal from a bug report.
NOT_ISSUE_KEYS = frozenset(
    "UTF UCS ISO IEC SHA CRC AES RSA HMAC RFC CVE CWE JSR JEP PEP IPV TLS SSL HTTP "
    "X86 LATIN WINDOWS CP EBCDIC ECMA ES H264 MP4".split()
)
_NOT_KEY = "(?!(?:" + "|".join(sorted(NOT_ISSUE_KEYS, key=len, reverse=True)) + r")-\d)"
ISSUE_KEY = re.compile(rf"\b{_NOT_KEY}[A-Z][A-Z0-9_]{{1,19}}-\d+\b")
ISSUE_URL = re.compile(r"https?://\S+/(?:browse|jira/browse|issues)/\S+", re.IGNORECASE)
DUPLICATE_PHRASE = re.compile(
    r"\b(?:(?:is\s+)?(?:a\s+)?dup(?:e|licate)?s?(?:d)?\s+(?:of|by)|closing\s+as\s+(?:a\s+)?dup(?:e|licate)?)\b",
    re.IGNORECASE,
)


@lru_cache(maxsize=32)
def _key_pattern(project_keys: frozenset[str] | None) -> re.Pattern:
    if not project_keys:
        return ISSUE_KEY
    names = "|".join(re.escape(k) for k in sorted(project_keys, key=len, reverse=True))
    return re.compile(rf"{ISSUE_KEY.pattern}|\b(?i:{names})-\d+\b")


def _keys(project_keys: Iterable[str] | None) -> re.Pattern:
    return _key_pattern(frozenset(project_keys) if project_keys else None)


def strip_answer_text(text: str, project_keys: Iterable[str] | None = None) -> str:
    """Remove issue URLs, issue keys and 'duplicate of' phrasing, then tidy whitespace."""
    text = ISSUE_URL.sub(" ", text)
    text = _keys(project_keys).sub(" ", text)
    text = DUPLICATE_PHRASE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize(text: str, project_keys: Iterable[str] | None = None) -> str:
    """Lowercase, drop issue keys and punctuation, collapse whitespace."""
    text = _keys(project_keys).sub(" ", text).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _fingerprint(normalized: str) -> str:
    return hashlib.sha1(normalized.encode()).hexdigest()


def cross_split_duplicates(
    train_texts: Iterable[str],
    test_texts: Sequence[str],
    project_keys: Iterable[str] | None = None,
) -> list[int]:
    """Indices of test texts whose normalized form also appears in the training texts.

    Empty texts are ignored: an empty description is not evidence of a copy.
    """
    keys = frozenset(project_keys) if project_keys else None
    seen = {_fingerprint(n) for t in train_texts if (n := normalize(t, keys))}
    return [i for i, t in enumerate(test_texts) if (n := normalize(t, keys)) and _fingerprint(n) in seen]
