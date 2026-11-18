import math

import numpy as np
import pytest

from hedge.risk import (
    NEVER_ACT,
    binomial_p_value,
    clustered_p_value,
    crc_threshold,
    ltt_threshold,
    one_per_group,
)


def synthetic(n, rng):
    """Scores where higher means more likely right: P(wrong | s) = 0.5 * (1 - s)."""
    s = rng.uniform(size=n)
    wrong = rng.uniform(size=n) < 0.5 * (1 - s)
    return s, wrong


def true_selective_risk(t):
    # E[wrong | s >= t] for s ~ U(0,1) and P(wrong | s) = 0.5 (1 - s): equals 0.25 (1 - t).
    return 0.25 * (1 - t)


def true_marginal_risk(t):
    # P(s >= t and wrong) = integral from t to 1 of 0.5 (1 - s) ds = 0.25 (1 - t)^2.
    return 0.25 * (1 - t) ** 2


def test_separable_scores_act_on_everything_right():
    s = [0.9] * 200 + [0.1] * 200
    wrong = [0] * 200 + [1] * 200
    t = ltt_threshold(s, wrong, alpha=0.05, delta=0.1)
    assert 0.1 < t.threshold <= 0.9 and t.errors == 0 and t.acted == 200


def test_too_few_items_cannot_be_certified():
    # Three perfect answers are not evidence of a 5% error rate.
    t = ltt_threshold([0.9, 0.8, 0.7], [0, 0, 0], alpha=0.05, delta=0.1)
    assert t.threshold == NEVER_ACT


def test_ltt_rejects_scores_outside_unit_interval():
    with pytest.raises(ValueError):
        ltt_threshold([1.5, 0.2], [0, 0], alpha=0.1)


def test_all_wrong_never_acts():
    t = ltt_threshold([0.9, 0.5, 0.1], [1, 1, 1], alpha=0.1)
    assert t.threshold == NEVER_ACT and t.coverage == 0.0


def test_crc_needs_enough_data_before_acting():
    # With n items the +1 in the bound means alpha must exceed 1 / (n + 1) to act at all.
    assert crc_threshold([0.9, 0.8], [0, 0], alpha=0.3).threshold == NEVER_ACT
    assert crc_threshold([0.9, 0.8], [0, 0], alpha=0.34).threshold == 0.8


def test_p_value_is_monotone_in_errors():
    ps = [binomial_p_value(k, 100, 0.05) for k in range(10)]
    assert all(a <= b for a, b in zip(ps, ps[1:]))
    assert binomial_p_value(0, 0, 0.05) == 1.0


@pytest.mark.parametrize("bad", [0.0, 1.0, -0.1])
def test_rejects_bad_alpha(bad):
    with pytest.raises(ValueError):
        ltt_threshold([0.5], [0], alpha=bad)
    with pytest.raises(ValueError):
        crc_threshold([0.5], [0], alpha=bad)


def test_rejects_mismatched_or_empty_input():
    with pytest.raises(ValueError):
        ltt_threshold([0.5, 0.4], [0], alpha=0.1)
    with pytest.raises(ValueError):
        crc_threshold([], [], alpha=0.1)
    with pytest.raises(ValueError):
        crc_threshold([math.nan], [0], alpha=0.1)


def test_ltt_guarantee_holds_over_many_calibration_draws():
    """P(true selective risk > alpha) must be at most delta (plus Monte Carlo slack)."""
    rng = np.random.default_rng(0)
    alpha, delta, trials = 0.1, 0.1, 400
    violations = 0
    for _ in range(trials):
        t = ltt_threshold(*synthetic(500, rng), alpha=alpha, delta=delta)
        if t.threshold != NEVER_ACT and true_selective_risk(t.threshold) > alpha:
            violations += 1
    assert violations / trials <= delta + 0.03


def test_crc_guarantee_holds_in_expectation():
    rng = np.random.default_rng(1)
    alpha, trials = 0.05, 400
    risks = []
    for _ in range(trials):
        t = crc_threshold(*synthetic(500, rng), alpha=alpha)
        risks.append(0.0 if t.threshold == NEVER_ACT else true_marginal_risk(t.threshold))
    assert np.mean(risks) <= alpha + 0.005


def clustered(groups, size, rng):
    """Clusters whose rows share one score and one outcome: the worst case for the test."""
    sg = rng.uniform(size=groups)
    wg = rng.uniform(size=groups) < 0.5 * (1 - sg)
    return np.repeat(sg, size), np.repeat(wg, size), np.repeat(np.arange(groups), size)


def violation_rate(groups, size, use_groups, trials=400, seed=0):
    rng = np.random.default_rng(seed)
    bad = 0
    for _ in range(trials):
        s, w, g = clustered(groups, size, rng)
        t = ltt_threshold(s, w, alpha=0.1, delta=0.1, groups=g if use_groups else None)
        bad += t.threshold != NEVER_ACT and true_selective_risk(t.threshold) > 0.1
    return bad / trials


def test_clustered_rows_break_the_naive_test():
    # Documents the failure the grouped test exists to fix: 50 clusters of 10 rows.
    assert violation_rate(50, 10, use_groups=False) > 0.2


def test_one_row_per_cluster_restores_the_guarantee():
    assert violation_rate(50, 10, use_groups=True) <= 0.1 + 0.03
    assert violation_rate(25, 20, use_groups=True) <= 0.1 + 0.03


def test_one_per_group_picks_exactly_one_row_each():
    g = np.array([3, 1, 3, 2, 1, 3])
    keep = one_per_group(g, seed=4)
    assert sorted(g[keep].tolist()) == [1, 2, 3]
    assert keep.tolist() == sorted(keep.tolist())
    with pytest.raises(ValueError):
        ltt_threshold([0.5, 0.6], [0, 0], alpha=0.1, groups=[1])


def brute_force_crc(s, w, alpha):
    """The original O(n^2) scan, kept as the reference for the fast version."""
    s, w = np.asarray(s, float), np.asarray(w, bool)
    best = NEVER_ACT
    for t in np.unique(s)[::-1]:
        if (np.sum((s >= t) & w) + 1) / (s.size + 1) <= alpha:
            best = t
        else:
            break
    return best


@pytest.mark.parametrize("seed", range(20))
def test_fast_crc_matches_brute_force_including_ties(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(5, 300))
    s = np.round(rng.uniform(size=n), 1)  # heavy ties
    w = rng.uniform(size=n) < 0.3 * (1 - s)
    alpha = float(rng.uniform(0.02, 0.3))
    assert crc_threshold(s, w, alpha).threshold == brute_force_crc(s, w, alpha)


def test_crc_scales_to_large_calibration_sets():
    rng = np.random.default_rng(0)
    s, w = synthetic(300_000, rng)
    t = crc_threshold(s, w, alpha=0.05)  # the O(n^2) version took minutes here
    assert 0 < t.coverage < 1


@pytest.mark.parametrize("grid", [[], [0.5, 0.5], [-0.1, 0.5], [0.5, 1.2], [[0.1, 0.2]]])
def test_ltt_rejects_bad_grids(grid):
    with pytest.raises(ValueError):
        ltt_threshold([0.5, 0.6], [0, 0], alpha=0.1, grid=grid)


def test_default_grid_cannot_be_mutated():
    from hedge.risk import DEFAULT_GRID

    with pytest.raises(ValueError):
        DEFAULT_GRID[0] = 0.5


def test_ltt_is_not_trivially_conservative():
    """On 5000 items the certified threshold should act on a real share of tickets."""
    rng = np.random.default_rng(2)
    t = ltt_threshold(*synthetic(5000, rng), alpha=0.1, delta=0.1)
    # The true selective risk is 0.1 at t = 0.6, i.e. coverage 0.4 is the oracle.
    assert 0.25 < t.coverage <= 0.45


def lopsided(rng, singles=300, clusters=15, size=20):
    """New reports are singletons and rarely wrong; duplicates arrive in clusters that are
    all wrong or all right together. Scores carry no signal, so every threshold has the same
    per-ticket risk: (300 * 0.02 + 300 * 0.5) / 600 = 26%."""
    s = np.r_[rng.uniform(size=singles), np.repeat(rng.uniform(size=clusters), size)]
    w = np.r_[rng.uniform(size=singles) < 0.02, np.repeat(rng.uniform(size=clusters) < 0.5, size)]
    g = np.r_[np.arange(singles), singles + np.repeat(np.arange(clusters), size)]
    return s, w, g


def lopsided_violations(grouped, trials=300, seed=0):
    rng = np.random.default_rng(seed)
    bad = 0
    for _ in range(trials):
        s, w, g = lopsided(rng)
        bad += ltt_threshold(s, w, alpha=0.1, delta=0.1, groups=g, grouped=grouped).threshold != NEVER_ACT
    return bad / trials


def test_one_row_per_group_fails_when_cluster_size_tracks_the_outcome():
    # One row per group estimates the error rate over groups (about 4%), not over tickets
    # (26%), so it certifies a 10% budget it is nowhere near.
    assert lopsided_violations("one-per-group") > 0.5


def test_clustered_bound_holds_when_cluster_size_tracks_the_outcome():
    assert lopsided_violations("bound") <= 0.1


def test_clustered_bound_holds_on_equal_clusters_too():
    rng = np.random.default_rng(1)
    bad = 0
    for _ in range(300):
        s, w, g = clustered(50, 10, rng)
        t = ltt_threshold(s, w, alpha=0.1, delta=0.1, groups=g)
        bad += t.threshold != NEVER_ACT and true_selective_risk(t.threshold) > 0.1
    assert bad / 300 <= 0.1


@pytest.mark.parametrize("errors,acted", [(0, 50), (2, 100), (10, 400), (30, 1000)])
def test_clustered_p_value_on_singletons_is_the_exact_binomial_tail(errors, acted):
    e = np.r_[np.ones(errors), np.zeros(acted - errors)]
    p = clustered_p_value(e, np.ones(acted), 0.1)
    assert p == pytest.approx(binomial_p_value(errors, acted, 0.1), rel=1e-12)


def test_clustered_p_value_on_singletons_gives_up_near_the_budget():
    # Hoeffding's comparison with the binomial needs errors <= n alpha - 1; between that and
    # n alpha the p-value is 1, which costs nothing because no test rejects there.
    assert clustered_p_value(np.r_[np.ones(9), np.zeros(91)], np.ones(100), 0.095) == 1.0


def poisson_chernoff(errors, acted, alpha):
    """The bound before Nov 18: 1 - x <= exp(-x) on every cluster, then a linear knapsack."""
    e, a = np.asarray(errors, float), np.asarray(acted, float)
    a, e = a[a > 0], e[a > 0]
    total, observed = a.sum(), e.sum()
    if observed >= alpha * total:
        return 1.0
    a = np.sort(a)[::-1]
    before = np.concatenate([[0.0], np.cumsum(a)[:-1]])
    q = np.clip((alpha * total - before) / a, 0.0, 1.0)
    lam = np.geomspace(1e-4, 50.0, 400)
    log_p = lam * observed - (1 - np.exp(-np.outer(lam, a))) @ q
    return float(min(1.0, np.exp(log_p.min())))


@pytest.mark.parametrize("seed", range(5))
def test_clustered_p_value_is_never_looser_than_the_poisson_bound(seed):
    rng = np.random.default_rng(seed)
    acted = np.r_[np.ones(400), rng.integers(2, 40, size=30)].astype(float)
    errors = np.where(acted == 1, rng.uniform(size=acted.size) < 0.01, 0.0) * acted
    new, old = clustered_p_value(errors, acted, 0.05), poisson_chernoff(errors, acted, 0.05)
    assert new <= old + 1e-12
    assert new < 0.9 * old  # and the gain is real, not rounding


def test_clustered_p_value_is_valid_for_all_or_nothing_clusters_at_the_budget():
    """The worst case the bound allows: clusters that are wholly right or wrong, with a
    per-ticket error rate exactly alpha. P(p <= level) must stay at or under level."""
    rng = np.random.default_rng(7)
    acted = np.r_[np.ones(300), np.full(20, 10.0)]
    alpha, level, trials = 0.1, 0.05, 2000
    hits = 0
    for _ in range(trials):
        errors = acted * (rng.uniform(size=acted.size) < alpha)
        hits += clustered_p_value(errors, acted, alpha) <= level
    assert hits / trials <= level + 0.015


def test_clustered_p_value_is_stricter_when_tickets_bunch():
    singles = clustered_p_value(np.zeros(200), np.ones(200), 0.05)
    bunched = clustered_p_value(np.zeros(10), np.full(10, 20.0), 0.05)
    assert singles < bunched <= 1.0
    assert clustered_p_value([5], [10], 0.1) == 1.0  # observed rate above alpha
    with pytest.raises(ValueError):
        clustered_p_value([3], [2], 0.1)
