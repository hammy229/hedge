"""Gate features: how sure the retriever looks about a ticket's best duplicate candidate.

Feature names must match app/src/features.js exactly, because the exported policy is a
mapping from these names to weights and the JavaScript gate fails closed on any name it
cannot find.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np

from .bm25 import tokenize

FEATURE_NAMES = (
    "top1",
    "margin",
    "entropy",
    "summaryWords",
    "hasDescription",
    "logWindow",
    "summaryOverlap",
    "logTopAgeDays",
)

# Bump whenever a feature's definition changes, and regenerate fixtures/features.json. A
# policy trained on one schema must not score features computed under another, so the
# version travels inside the policy and the Forge gate checks it.
FEATURE_SCHEMA = 2


def score_features(scores: Sequence[float], k: int = 10) -> dict[str, float]:
    """Features from a ticket's retrieval scores, best first.

    top1     best score
    margin   best minus second best (0 if there is only one candidate)
    entropy  entropy of a softmax over the top k scores, divided by log(k), so 0 means one
             candidate dominates and 1 means k candidates are indistinguishable

    The denominator is log(k) even when fewer than k candidates exist. Dividing by the
    number actually returned would score two tied candidates as 1.0, exactly as unsure as
    ten tied candidates, and would make the feature mean different things for tickets in
    small and large projects.
    """
    if k < 2:
        raise ValueError("k must be at least 2")
    s = np.asarray(scores, dtype=float)
    if not np.all(np.isfinite(s)):
        # A broken retriever score must not turn into a confident-looking feature. NaN
        # features make both gates ask.
        return {"top1": math.nan, "margin": math.nan, "entropy": math.nan}
    s = np.sort(s)[::-1][:k]
    if s.size == 0:
        return {"top1": 0.0, "margin": 0.0, "entropy": 1.0}
    margin = float(s[0] - s[1]) if s.size > 1 else 0.0
    if s.size == 1:
        return {"top1": float(s[0]), "margin": margin, "entropy": 0.0}
    p = np.exp(s - s.max())
    p /= p.sum()
    entropy = float(-(p * np.log(np.clip(p, 1e-300, None))).sum() / np.log(k))
    return {"top1": float(s[0]), "margin": margin, "entropy": entropy}


def text_features(summary: str, description: str) -> dict[str, float]:
    """Same definitions as featurize() in app/src/features.js."""
    return {
        "summaryWords": float(len(summary.split())),
        "hasDescription": 1.0 if description.strip() else 0.0,
    }


DAY = 86400.0


def context_features(window: int, summary: str, top_summary: str | None, age_seconds: float | None) -> dict[str, float]:
    """What the scores alone miss. Same definitions as contextFeatures() in app/src/features.js.

    logWindow       log(1 + issues searched). BM25 scores grow with the window: in a
                    two-issue window an exact copy scores lower than a weak match in a full
                    one, so top1 means little without it.
    summaryOverlap  Jaccard overlap of the token sets (BM25 tokens) of the ticket's summary
                    and the top candidate's. Duplicates tend to restate the title.
    logTopAgeDays   log(1 + days between the top candidate and the ticket). Duplicates of a
                    fresh bug arrive within days.

    With no candidate, overlap and age are 0: top1 = 0 already says nothing matched. An age
    that is not a finite number gives NaN, so both gates ask.
    """
    if top_summary is None:
        return {"logWindow": math.log1p(window), "summaryOverlap": 0.0, "logTopAgeDays": 0.0}
    a, b = set(tokenize(summary)), set(tokenize(top_summary))
    overlap = len(a & b) / len(a | b) if a | b else 0.0
    if age_seconds is None or not math.isfinite(age_seconds):
        age = math.nan
    else:
        age = math.log1p(max(age_seconds, 0.0) / DAY)
    return {"logWindow": math.log1p(window), "summaryOverlap": overlap, "logTopAgeDays": age}


def gate_features(
    scores: Sequence[float],
    summary: str,
    description: str,
    window: int,
    top_summary: str | None,
    age_seconds: float | None,
) -> dict[str, float]:
    return {
        **score_features(scores),
        **text_features(summary, description),
        **context_features(window, summary, top_summary, age_seconds),
    }


def to_matrix(rows: Sequence[dict[str, float]]) -> np.ndarray:
    """Stack feature dicts into an (n, len(FEATURE_NAMES)) array in canonical order."""
    return np.array([[row[name] for name in FEATURE_NAMES] for row in rows], dtype=float)
