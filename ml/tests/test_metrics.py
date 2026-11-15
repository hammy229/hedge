import numpy as np
import pytest

from hedge.metrics import aurc, cluster_bootstrap_ci, coverage_at_risk, risk_coverage_curve


def test_curve_by_hand():
    coverage, risk = risk_coverage_curve([0.9, 0.8, 0.3, 0.1], [0, 1, 0, 1])
    np.testing.assert_allclose(coverage, [0.25, 0.5, 0.75, 1.0])
    np.testing.assert_allclose(risk, [0, 0.5, 1 / 3, 0.5])
    assert aurc([0.9, 0.8, 0.3, 0.1], [0, 1, 0, 1]) == pytest.approx((0 + 0.5 + 1 / 3 + 0.5) / 4)


def test_ties_count_against_the_model():
    # All scores equal: the curve must not reward the model for lucky ordering.
    _, risk = risk_coverage_curve([0.5, 0.5], [0, 1])
    assert risk[0] == 1.0


def test_perfect_ranking_beats_reversed():
    wrong = [0, 0, 0, 1, 1]
    assert aurc([5, 4, 3, 2, 1], wrong) < aurc([1, 2, 3, 4, 5], wrong)


def test_coverage_at_risk():
    assert coverage_at_risk([0.9, 0.8, 0.3, 0.1], [0, 1, 0, 1], alpha=0.0) == 0.25
    assert coverage_at_risk([0.9], [1], alpha=0.1) == 0.0


def test_bootstrap_ci_covers_the_mean():
    rng = np.random.default_rng(0)
    values = rng.normal(loc=3.0, size=600)
    clusters = np.repeat(np.arange(30), 20)
    point, lo, hi = cluster_bootstrap_ci(lambda idx: values[idx].mean(), clusters, n_boot=500)
    assert lo < 3.0 < hi and lo < point < hi


def test_cluster_ci_is_wider_than_naive_when_clusters_correlate():
    rng = np.random.default_rng(1)
    shift = np.repeat(rng.normal(scale=2.0, size=10), 50)  # strong per-project effect
    values = shift + rng.normal(size=500)
    stat = lambda idx: values[idx].mean()  # noqa: E731
    _, lo_c, hi_c = cluster_bootstrap_ci(stat, np.repeat(np.arange(10), 50), n_boot=500)
    _, lo_n, hi_n = cluster_bootstrap_ci(stat, np.arange(500), n_boot=500)
    assert hi_c - lo_c > 2 * (hi_n - lo_n)


def test_bootstrap_needs_two_clusters():
    with pytest.raises(ValueError):
        cluster_bootstrap_ci(lambda idx: 0.0, [1, 1, 1])
