import numpy as np
import pytest

from hedge.evaluate import compare, evaluate_method, to_markdown


def tickets(n=3000, seed=0):
    rng = np.random.default_rng(seed)
    good = rng.uniform(size=n)  # informative score
    wrong = (rng.uniform(size=n) < 0.4 * (1 - good)).astype(int)
    noise = rng.uniform(size=n)  # uninformative score
    clusters = rng.integers(0, 30, size=n)
    return good, noise, wrong, clusters


def test_informative_method_beats_noise():
    good, noise, wrong, clusters = tickets()
    res = compare({"gate": good, "noise": noise}, wrong, clusters, n_boot=200)
    assert res["gate"]["aurc"][0] < res["noise"]["aurc"][0]
    assert res["gate"]["coverage@0.05"][0] > res["noise"]["coverage@0.05"][0]
    for r in res.values():
        point, lo, hi = r["aurc"]
        assert lo <= point <= hi


def test_realized_risk_only_with_a_finite_threshold():
    good, _, wrong, clusters = tickets()
    with_t = evaluate_method(good, wrong, clusters, threshold=0.8, n_boot=100)
    no_t = evaluate_method(good, wrong, clusters, threshold=float("inf"), n_boot=100)
    assert "realized_risk" in with_t and "realized_risk" not in no_t
    # Above 0.8 the true error rate is 0.4 * (1 - s) averaged over s in [0.8, 1] = 0.04.
    assert with_t["realized_risk"][0] == pytest.approx(0.04, abs=0.02)
    assert with_t["realized_coverage"][0] == pytest.approx(0.2, abs=0.03)


def test_markdown_table_shape():
    good, noise, wrong, clusters = tickets(800)
    res = compare(
        {"gate": good, "noise": noise}, wrong, clusters, thresholds={"gate": 0.8}, n_boot=50
    )
    md = to_markdown(res)
    lines = md.strip().splitlines()
    assert len(lines) == 4
    assert all(line.count("|") == lines[0].count("|") for line in lines)
    assert "none certified" in lines[3]


def test_length_mismatch():
    with pytest.raises(ValueError):
        evaluate_method([0.5, 0.4], [0, 1], [0])
