"""Gate features: how sure the retriever looks about a ticket's best duplicate candidate.

Feature names must match app/src/features.js exactly, because the exported policy is a
mapping from these names to weights and the JavaScript gate fails closed on any name it
cannot find.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

FEATURE_NAMES = ("top1", "margin", "entropy", "summaryWords", "hasDescription")

# Bump whenever a feature's definition changes, and regenerate fixtures/features.json. A
# policy trained on one schema must not score features computed under another, so the
# version travels inside the policy and the Forge gate checks it.
FEATURE_SCHEMA = 1


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
    s = np.sort(np.asarray(scores, dtype=float))[::-1][:k]
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


def gate_features(scores: Sequence[float], summary: str, description: str) -> dict[str, float]:
    return {**score_features(scores), **text_features(summary, description)}


def to_matrix(rows: Sequence[dict[str, float]]) -> np.ndarray:
    """Stack feature dicts into an (n, len(FEATURE_NAMES)) array in canonical order."""
    return np.array([[row[name] for name in FEATURE_NAMES] for row in rows], dtype=float)
