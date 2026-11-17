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


def recall_at_k(ranked: Sequence[Sequence], relevant: Sequence[set], k: int) -> float:
    """Share of queries with at least one relevant item in their top k.

    Queries with no relevant item are skipped: recall is undefined for them. They still
    matter for the gate, which must learn to not act on them.
    """
    hits = [bool(set(r[:k]) & rel) for r, rel in zip(ranked, relevant, strict=True) if rel]
    return float(np.mean(hits)) if hits else float("nan")


def mean_reciprocal_rank(ranked: Sequence[Sequence], relevant: Sequence[set]) -> float:
    """Mean of 1 / rank of the first relevant item (0 when none is retrieved)."""
    rr = []
    for r, rel in zip(ranked, relevant, strict=True):
        if not rel:
            continue
        rank = next((i for i, x in enumerate(r, start=1) if x in rel), None)
        rr.append(1 / rank if rank else 0.0)
    return float(np.mean(rr)) if rr else float("nan")


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
    # One stable sort groups the rows, instead of a full scan per cluster (O(n log n), not
    # O(n * clusters), which matters with one cluster per duplicate group).
    _, inverse = np.unique(labels, return_inverse=True)
    order = np.argsort(inverse, kind="stable")
    groups = np.split(order, np.flatnonzero(np.diff(inverse[order])) + 1)
    if len(groups) < 2:
        raise ValueError("need at least two clusters to bootstrap")
    rng = np.random.default_rng(seed)
    point = statistic(np.arange(labels.size))
    stats = np.empty(n_boot)
    for b in range(n_boot):
        picks = rng.integers(0, len(groups), size=len(groups))
        stats[b] = statistic(np.concatenate([groups[i] for i in picks]))
    # A resample can leave the statistic undefined (no acted tickets, so no error rate).
    # Those draws are dropped rather than counted as 0, which would pull the interval down.
    stats = stats[np.isfinite(stats)]
    if stats.size == 0:
        return float(point), float("nan"), float("nan")
    tail = (1 - level) / 2
    lo, hi = np.quantile(stats, [tail, 1 - tail])
    return float(point), float(lo), float(hi)
