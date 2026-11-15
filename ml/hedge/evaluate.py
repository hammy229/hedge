"""Compare confidence methods on held-out tickets and render the results table.

A *method* is any way of scoring how safe it is to act on a ticket: Hedge's gate, the LLM's
stated confidence, the raw retrieval score. Every method is judged on the same test
tickets, with intervals from a bootstrap that resamples whole projects.

Two kinds of numbers come out, and they answer different questions:

- ``aurc`` and ``coverage@alpha`` describe the method's ranking quality on the test set.
  They are measured, not guaranteed.
- ``realized_risk`` takes a threshold certified on the *calibration* set and reports the
  error rate it actually produced on the *test* set. This is the check that the guarantee
  survived contact with later data.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

import numpy as np

from .metrics import aurc, cluster_bootstrap_ci, coverage_at_risk


def _selective(scores: np.ndarray, wrong: np.ndarray, threshold: float, idx: np.ndarray):
    act = scores[idx] >= threshold
    acted = act.sum()
    risk = wrong[idx][act].mean() if acted else 0.0
    return float(risk), float(act.mean())


def evaluate_method(
    scores: Sequence[float],
    wrong: Sequence[int],
    clusters: Sequence,
    alphas: Sequence[float] = (0.01, 0.03, 0.05, 0.1),
    threshold: float | None = None,
    n_boot: int = 1000,
    seed: int = 0,
) -> dict:
    s = np.asarray(scores, dtype=float)
    w = np.asarray(wrong, dtype=float)
    if s.shape != w.shape or s.size != len(clusters):
        raise ValueError("scores, wrong and clusters must have the same length")
    boot = dict(clusters=clusters, n_boot=n_boot, seed=seed)
    out = {"n": int(s.size), "aurc": cluster_bootstrap_ci(lambda i: aurc(s[i], w[i]), **boot)}
    for a in alphas:
        out[f"coverage@{a:g}"] = cluster_bootstrap_ci(
            lambda i, a=a: coverage_at_risk(s[i], w[i], a), **boot
        )
    if threshold is not None and np.isfinite(threshold):
        out["threshold"] = float(threshold)
        out["realized_risk"] = cluster_bootstrap_ci(
            lambda i: _selective(s, w, threshold, i)[0], **boot
        )
        out["realized_coverage"] = cluster_bootstrap_ci(
            lambda i: _selective(s, w, threshold, i)[1], **boot
        )
    return out


def compare(
    methods: Mapping[str, Sequence[float]],
    wrong: Sequence[int],
    clusters: Sequence,
    thresholds: Mapping[str, float] | None = None,
    **kwargs,
) -> dict[str, dict]:
    thresholds = thresholds or {}
    return {
        name: evaluate_method(scores, wrong, clusters, threshold=thresholds.get(name), **kwargs)
        for name, scores in methods.items()
    }


def _fmt(cell, pct: bool) -> str:
    point, lo, hi = cell
    if pct:
        return f"{point:.1%} [{lo:.1%}, {hi:.1%}]"
    return f"{point:.3f} [{lo:.3f}, {hi:.3f}]"


def to_markdown(results: Mapping[str, dict]) -> str:
    """One row per method. Coverage and risk cells are percentages with 95% CIs."""
    first = next(iter(results.values()))
    cov_keys = [k for k in first if k.startswith("coverage@")]
    header = ["Method", "AURC (lower is better)"] + [f"Coverage at {k[9:]} risk" for k in cov_keys]
    has_cert = any("realized_risk" in r for r in results.values())
    if has_cert:
        header += ["Certified threshold: test error", "Certified threshold: test coverage"]
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    for name, r in results.items():
        row = [name, _fmt(r["aurc"], pct=False)] + [_fmt(r[k], pct=True) for k in cov_keys]
        if has_cert:
            row += (
                [_fmt(r["realized_risk"], True), _fmt(r["realized_coverage"], True)]
                if "realized_risk" in r
                else ["none certified", "0%"]
            )
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines) + "\n"
