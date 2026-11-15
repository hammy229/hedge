import math

import numpy as np
import pytest

from hedge.risk import NEVER_ACT, binomial_p_value, crc_threshold, ltt_threshold


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


def test_ltt_is_not_trivially_conservative():
    """On 5000 items the certified threshold should act on a real share of tickets."""
    rng = np.random.default_rng(2)
    t = ltt_threshold(*synthetic(5000, rng), alpha=0.1, delta=0.1)
    # The true selective risk is 0.1 at t = 0.6, i.e. coverage 0.4 is the oracle.
    assert 0.25 < t.coverage <= 0.45
