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
    # Sort once, highest score first. errors_at[j] = wrong rows among those with score >= the
    # j-th distinct score, so every candidate is checked in O(1) after an O(n log n) sort.
    order = np.argsort(-s, kind="stable")
    s_sorted, w_sorted = s[order], w[order]
    cum_wrong = np.cumsum(w_sorted)
    last_of_value = np.flatnonzero(np.append(s_sorted[1:] != s_sorted[:-1], True))
    ok = (cum_wrong[last_of_value] + 1) / (n + 1) <= alpha
    # The loss only grows as the threshold falls, so passing candidates form a prefix.
    passing = np.flatnonzero(~ok)
    k = passing[0] if passing.size else ok.size
    if k == 0:
        return Threshold(NEVER_ACT, 0.0, 0, 0)
    return _summary(s, w, float(s_sorted[last_of_value[k - 1]]))


def binomial_p_value(errors: int, acted: int, alpha: float) -> float:
    """P(Binomial(acted, alpha) <= errors): small when the error rate is clearly below alpha."""
    if acted == 0:
        return 1.0
    return float(binom.cdf(errors, acted, alpha))


_LAMBDAS = np.geomspace(1e-4, 50.0, 400)


def clustered_p_value(errors, acted, alpha: float) -> float:
    """A p-value for "the per-ticket error rate among acted tickets is above alpha", valid
    when clusters are independent and tickets inside a cluster may depend on each other
    in any way.

    ``errors[c]`` and ``acted[c]`` count cluster c's wrong and acted tickets. Let A_c be
    its acted count and E_c its errors, so E_c lies in [0, A_c]. By convexity,
    E[exp(-lam E_c)] <= 1 - q_c (1 - exp(-lam A_c)) with q_c = E[E_c] / A_c: the worst case
    is a cluster that is all right or all wrong together. Under the null the q_c average
    at least alpha, weighted by A_c, and the bound's maximum over such q_c is a fractional
    knapsack that puts the error mass on the largest clusters first. A Chernoff bound over
    a fixed grid of lam then gives P(total errors <= observed) <= p. With every cluster of
    size one this is the Poisson Chernoff bound, a little looser than the exact binomial.
    """
    e = np.asarray(errors, dtype=float)
    a = np.asarray(acted, dtype=float)
    if e.shape != a.shape or np.any(e < 0) or np.any(e > a):
        raise ValueError("need 0 <= errors <= acted for every cluster")
    a, e = a[a > 0], e[a > 0]
    total, observed = a.sum(), e.sum()
    if total == 0 or observed >= alpha * total:
        return 1.0
    a = np.sort(a)[::-1]
    budget = alpha * total
    before = np.concatenate([[0.0], np.cumsum(a)[:-1]])
    q = np.clip((budget - before) / a, 0.0, 1.0)
    log_p = _LAMBDAS * observed - (1 - np.exp(-np.outer(_LAMBDAS, a))) @ q
    return float(min(1.0, np.exp(log_p.min())))


DEFAULT_GRID = np.linspace(0.0, 1.0, 101)
DEFAULT_GRID.flags.writeable = False


def one_per_group(groups, seed: int = 0) -> np.ndarray:
    """Indices of one randomly chosen row per group, in ascending order.

    The binomial test counts each row as an independent trial. Jira tickets are not: a
    burst of duplicates of one bug tends to be all right or all wrong together. Counting
    such a cluster as 20 trials makes the test overconfident, and on synthetic clustered
    data it certified bad thresholds 2.5 to 4 times more often than delta allows (see
    tests/test_risk.py). Keeping one row per cluster restores independent trials, at the
    price of a smaller calibration set.
    """
    g = np.asarray(groups)
    rng = np.random.default_rng(seed)
    order = rng.permutation(g.size)
    _, first = np.unique(g[order], return_index=True)
    return np.sort(order[first])


def ltt_threshold(
    scores,
    wrong,
    alpha: float,
    delta: float = 0.1,
    grid=DEFAULT_GRID,
    groups=None,
    seed: int = 0,
    grouped: str = "bound",
) -> Threshold:
    """Most lenient grid threshold whose selective risk is certified <= alpha at level delta.

    Each grid point t carries the null "the error rate among items with score >= t is
    above alpha". A null is rejected when its p-value (binomial, or ``clustered_p_value``
    with groups) is at most delta / len(grid),
    so the chance of certifying any bad threshold is at most delta. The grid must be fixed
    before seeing the calibration data, which is why scores live in [0, 1].

    Pass ``groups`` (a duplicate cluster or project id per row) whenever rows can be
    correlated. The test then counts errors per group and uses ``clustered_p_value``,
    which controls the per-ticket error rate under any dependence inside a group.

    ``grouped="one-per-group"`` keeps the older test on one random row per group. It is
    valid only when every group has the same size: it certifies the error rate over
    groups, and when wrong tickets come in large clusters (new reports are singletons,
    duplicates of one bug come in bursts) that rate sits far below the per-ticket rate.
    On the real calibration rows the duplicate rate is 15.1% per ticket and 8.2% per
    group, and the older test certified thresholds that went over budget (ADR 5).
    """
    if not 0 < alpha < 1 or not 0 < delta < 1:
        raise ValueError("alpha and delta must be in (0, 1)")
    if grouped not in ("bound", "one-per-group"):
        raise ValueError("grouped must be 'bound' or 'one-per-group'")
    s, w = _as_arrays(scores, wrong)
    g_idx = None
    if groups is not None:
        if len(groups) != s.size:
            raise ValueError("groups must have one entry per score")
        if grouped == "one-per-group":
            keep = one_per_group(groups, seed)
            s, w = s[keep], w[keep]
        else:
            _, g_idx = np.unique(np.asarray(groups), return_inverse=True)
    if s.min() < 0 or s.max() > 1:
        raise ValueError("scores must be probabilities in [0, 1]")
    g = np.asarray(grid, dtype=float)
    if g.ndim != 1 or g.size == 0:
        raise ValueError("grid must be a non-empty 1-D sequence")
    if g.min() < 0 or g.max() > 1 or np.unique(g).size != g.size:
        raise ValueError("grid points must be distinct and lie in [0, 1]")
    level = delta / g.size

    def p_value(t: float) -> float:
        act = s >= t
        if g_idx is None:
            return binomial_p_value(int((act & w).sum()), int(act.sum()), alpha)
        return clustered_p_value(np.bincount(g_idx, weights=act & w), np.bincount(g_idx, weights=act), alpha)

    certified = [t for t in g if p_value(t) <= level]
    if not certified:
        return Threshold(NEVER_ACT, 0.0, 0, 0)
    return _summary(s, w, float(min(certified)))
