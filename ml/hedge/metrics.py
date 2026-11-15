"""Selective prediction metrics and a cluster bootstrap for confidence intervals."""

from __future__ import annotations

from collections.abc import Callable, Sequence

import numpy as np


def risk_coverage_curve(scores, wrong) -> tuple[np.ndarray, np.ndarray]:
    """Coverage and selective risk when acting on the top k items, for k = 1..n.

    Ties in score are broken by putting wrong items first, so a model cannot look better
    by giving everything the same score.
    """
    s = np.asarray(scores, dtype=float)
    w = np.asarray(wrong, dtype=float)
    if s.shape != w.shape or s.ndim != 1 or s.size == 0:
        raise ValueError("scores and wrong must be non-empty 1-D arrays of the same length")
    order = np.lexsort((-w, -s))  # primary key: score descending, then wrong first
    k = np.arange(1, s.size + 1)
    return k / s.size, np.cumsum(w[order]) / k


def aurc(scores, wrong) -> float:
    """Area under the risk-coverage curve (lower is better), Geifman et al. 2018."""
    _, risk = risk_coverage_curve(scores, wrong)
    return float(risk.mean())


def coverage_at_risk(scores, wrong, alpha: float) -> float:
    """Largest empirical coverage whose selective risk is at most alpha (no guarantee)."""
    coverage, risk = risk_coverage_curve(scores, wrong)
    ok = risk <= alpha
    return float(coverage[ok].max()) if ok.any() else 0.0


def cluster_bootstrap_ci(
    statistic: Callable[[np.ndarray], float],
    clusters: Sequence,
    n_boot: int = 2000,
    level: float = 0.95,
    seed: int = 0,
) -> tuple[float, float, float]:
    """Point estimate and percentile CI, resampling whole clusters with replacement.

    ``statistic`` receives an array of row indices. Tickets from the same Jira project are
    correlated, so the CI resamples projects, not tickets; resampling tickets would give
    intervals that are too narrow.
    """
    labels = np.asarray(clusters)
    groups = [np.flatnonzero(labels == c) for c in np.unique(labels)]
    if len(groups) < 2:
        raise ValueError("need at least two clusters to bootstrap")
    rng = np.random.default_rng(seed)
    point = statistic(np.arange(labels.size))
    stats = np.empty(n_boot)
    for b in range(n_boot):
        picks = rng.integers(0, len(groups), size=len(groups))
        stats[b] = statistic(np.concatenate([groups[i] for i in picks]))
    tail = (1 - level) / 2
    lo, hi = np.quantile(stats, [tail, 1 - tail])
    return float(point), float(lo), float(hi)
