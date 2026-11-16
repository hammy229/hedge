import math

import numpy as np
import pytest

from hedge.features import FEATURE_NAMES, gate_features, score_features, text_features, to_matrix


def test_one_clear_winner_has_low_entropy():
    clear = score_features([20.0, 2.0, 1.5, 1.0])
    tied = score_features([5.0] * 10)
    assert clear["margin"] == 18.0 and clear["entropy"] < 0.01
    assert tied["margin"] == 0.0 and tied["entropy"] == pytest.approx(1.0)


def test_entropy_denominator_is_fixed_at_log_k():
    # Two tied candidates are less ambiguous than ten tied candidates.
    two = score_features([5.0, 5.0], k=10)["entropy"]
    assert two == pytest.approx(math.log(2) / math.log(10))
    assert two < score_features([5.0] * 10, k=10)["entropy"]
    with pytest.raises(ValueError):
        score_features([1.0, 2.0], k=1)


def test_scores_are_sorted_before_use():
    assert score_features([1.0, 9.0, 4.0]) == score_features([9.0, 4.0, 1.0])


def test_edge_cases():
    assert score_features([]) == {"top1": 0.0, "margin": 0.0, "entropy": 1.0}
    assert score_features([3.0]) == {"top1": 3.0, "margin": 0.0, "entropy": 0.0}


def test_entropy_is_stable_for_large_scores():
    f = score_features([1e6, 1e6 - 1, 0.0])
    assert math.isfinite(f["entropy"]) and 0 <= f["entropy"] <= 1


def test_text_features_match_the_forge_app():
    # Mirrors the 'featurize handles a bare issue' case in app/test/gate.test.js.
    assert text_features("Crash on save", "") == {"summaryWords": 3.0, "hasDescription": 0.0}
    assert text_features("x", "  some text ") ["hasDescription"] == 1.0


def test_matrix_uses_canonical_order():
    row = gate_features([4.0, 1.0], "Crash on save", "details")
    m = to_matrix([row, row])
    assert m.shape == (2, len(FEATURE_NAMES))
    np.testing.assert_array_equal(m[0], [row[n] for n in FEATURE_NAMES])
