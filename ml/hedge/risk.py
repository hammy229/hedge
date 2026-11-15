"""Pick the confidence threshold above which the agent is allowed to act.

The agent acts on an item when its score is at least ``threshold`` and asks a human
otherwise. Two guarantees are offered, both computed from a held-out calibration set.

``crc_threshold``
    Conformal risk control (Angelopoulos et al., 2022). Controls the *marginal* risk
    P(act and wrong) <= alpha in expectation over the calibration draw. Cheap and tight,
    but it counts mistakes over every ticket, including the ones the agent hands off.

``ltt_threshold``
    Learn then Test (Angelopoulos et al., 2021) with a binomial tail p-value and a
    Bonferroni correction over a fixed threshold grid. Controls the *selective* risk
    P(wrong | act) <= alpha with probability at least 1 - delta over the calibration draw.
    This is the number an admin means by "auto-act at most 3% wrong", so it is the one the
    product exposes.

    Fixed sequence testing (strictest threshold first) looks tighter on paper but fails in
    practice here: the strictest thresholds act on one or two tickets, so their nulls can
    never be rejected and testing stops before reaching any useful threshold. Bonferroni
    costs a log factor in delta, needs no monotonicity, and is valid under any dependence.

Both assume calibration and future items are exchangeable. Ticket streams drift, so the
evaluation reports realized risk on a later time window instead of trusting the bound.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.stats import binom

NEVER_ACT = math.inf


@dataclass(frozen=True)
class Threshold:
    """A calibrated threshold and the calibration-set facts behind it."""

    threshold: float
    coverage: float  # share of calibration items the agent would act on
    errors: int  # wrong actions among them
    acted: int


def _as_arrays(scores, wrong) -> tuple[np.ndarray, np.ndarray]:
    s = np.asarray(scores, dtype=float)
    w = np.asarray(wrong, dtype=bool)
    if s.ndim != 1 or s.shape != w.shape:
        raise ValueError("scores and wrong must be 1-D arrays of the same length")
    if s.size == 0:
        raise ValueError("calibration set is empty")
    if not np.all(np.isfinite(s)):
        raise ValueError("scores must be finite")
    return s, w


def _candidates_strict_to_lenient(s: np.ndarray) -> np.ndarray:
    """Unique scores, highest first. Acting at a threshold t means acting on score >= t."""
    return np.unique(s)[::-1]


def _summary(s: np.ndarray, w: np.ndarray, t: float) -> Threshold:
    act = s >= t
    return Threshold(t, float(act.mean()), int((act & w).sum()), int(act.sum()))


def crc_threshold(scores, wrong, alpha: float) -> Threshold:
    """Most lenient threshold with (sum of losses + 1) / (n + 1) <= alpha.

    The loss for item i at threshold t is 1[score_i >= t and wrong_i]. It can only fall as
    t rises and is bounded by 1, which is what the conformal risk control bound needs.
    """
    if not 0 < alpha < 1:
        raise ValueError("alpha must be in (0, 1)")
    s, w = _as_arrays(scores, wrong)
    n = s.size
    best = NEVER_ACT
    for t in _candidates_strict_to_lenient(s):
        if (np.sum((s >= t) & w) + 1) / (n + 1) <= alpha:
            best = t
        else:
            break  # the loss only grows as t falls, so no later candidate can pass
    if best == NEVER_ACT:
        return Threshold(NEVER_ACT, 0.0, 0, 0)
    return _summary(s, w, best)


def binomial_p_value(errors: int, acted: int, alpha: float) -> float:
    """P(Binomial(acted, alpha) <= errors): small when the error rate is clearly below alpha."""
    if acted == 0:
        return 1.0
    return float(binom.cdf(errors, acted, alpha))


DEFAULT_GRID = np.linspace(0.0, 1.0, 101)


def ltt_threshold(
    scores, wrong, alpha: float, delta: float = 0.1, grid=DEFAULT_GRID
) -> Threshold:
    """Most lenient grid threshold whose selective risk is certified <= alpha at level delta.

    Each grid point t carries the null "the error rate among items with score >= t is
    above alpha". A null is rejected when its binomial p-value is at most delta / len(grid),
    so the chance of certifying any bad threshold is at most delta. The grid must be fixed
    before seeing the calibration data, which is why scores live in [0, 1].
    """
    if not 0 < alpha < 1 or not 0 < delta < 1:
        raise ValueError("alpha and delta must be in (0, 1)")
    s, w = _as_arrays(scores, wrong)
    if s.min() < 0 or s.max() > 1:
        raise ValueError("scores must be probabilities in [0, 1]")
    g = np.asarray(grid, dtype=float)
    level = delta / g.size
    certified = [
        t
        for t in g
        if binomial_p_value(int(((s >= t) & w).sum()), int((s >= t).sum()), alpha) <= level
    ]
    if not certified:
        return Threshold(NEVER_ACT, 0.0, 0, 0)
    return _summary(s, w, float(min(certified)))
