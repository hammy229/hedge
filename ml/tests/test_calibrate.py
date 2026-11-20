import json

import numpy as np
import pytest

from hedge.calibrate import build_policy, main
from hedge.features import FEATURE_NAMES, to_matrix


def rows(n, seed=0, signal=3.0):
    """Synthetic tickets where a big margin means the top candidate is the true duplicate."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        margin = rng.exponential(2.0)
        right = int(rng.uniform() < 1 / (1 + np.exp(-(signal * (margin - 2.0)))))
        out.append(
            {
                "split": "train" if i < n // 2 else "calibration",
                "right": right,
                "top1": 10 + margin + rng.normal(),
                "margin": margin,
                "entropy": float(np.exp(-margin)),
                "summaryWords": float(rng.integers(3, 15)),
                "hasDescription": float(rng.uniform() < 0.8),
                "logWindow": float(np.log1p(rng.integers(0, 1001))),
                "summaryOverlap": float(rng.uniform()),
                "logTopAgeDays": float(np.log1p(rng.exponential(30.0))),
            }
        )
    return out


def test_policy_from_informative_features_acts_on_some_tickets():
    policy = build_policy(rows(6000), alpha=0.05, delta=0.1, retriever="bm25-v1")
    assert policy["calibrated"] is True
    assert 0.1 < policy["calibrationCoverage"] < 0.9
    assert set(policy["model"]["weights"]) == set(FEATURE_NAMES)


def test_useless_features_never_get_certified():
    policy = build_policy(rows(3000, signal=0.0), alpha=0.05, delta=0.1, retriever="bm25-v1")
    assert policy["calibrated"] is False


def test_missing_split_is_an_error():
    with pytest.raises(ValueError):
        build_policy([r | {"split": "train"} for r in rows(100)], alpha=0.05, delta=0.1, retriever="bm25-v1")


@pytest.mark.parametrize("bad", [{"split": "calib"}, {"right": 2}, {"right": None}])
def test_bad_rows_are_errors_not_silently_dropped(bad):
    data = rows(200)
    data[150] = data[150] | bad
    with pytest.raises(ValueError, match="row 150"):
        build_policy(data, alpha=0.05, delta=0.1, retriever="bm25-v1")


def test_grouped_rows_are_all_used_and_cost_some_coverage():
    data = rows(6000)
    grouped = [r | {"group": i // 3} for i, r in enumerate(data)]
    policy = build_policy(grouped, alpha=0.05, delta=0.1, retriever="bm25-v1")
    plain = build_policy(data, alpha=0.05, delta=0.1, retriever="bm25-v1")
    assert policy["calibrationSize"] == 3000  # every calibration ticket counts
    assert policy["calibrationCoverage"] <= plain["calibrationCoverage"]
    assert policy["calibrationActed"] >= policy["calibrationErrors"] >= 0


def with_answers(data):
    """Tickets whose top candidate is right have a duplicate; a few others do too."""
    return [{**r, "has_answer": bool(r["right"]) or i % 50 == 0, "jira": "A" if i % 4 else "B"} for i, r in enumerate(data)]


def read_policies(path):
    return json.loads(path.read_text().split("export default ", 1)[1].rstrip().rstrip(";"))


def test_cli_writes_both_actions_into_one_importable_file(tmp_path, capsys):
    path = tmp_path / "rows.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in with_answers(rows(4000))) + "\n")
    out = tmp_path / "policy.js"
    assert main([str(path), "--alpha", "0.05", "--retriever", "bm25-v1", "--out", str(out)]) == 0
    policies = read_policies(out)
    assert set(policies) == {"link", "clear"}
    assert {p["action"] for p in policies.values()} == {"link", "clear"}
    assert policies["link"]["calibrated"] is True
    printed = capsys.readouterr().out
    assert "link:" in printed and "clear:" in printed


def test_cli_can_leave_a_jira_out_and_records_it(tmp_path):
    path = tmp_path / "rows.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in with_answers(rows(4000))) + "\n")
    out = tmp_path / "policy.js"
    main([str(path), "--retriever", "bm25-v1", "--out", str(out), "--exclude-jira", "B"])
    policies = read_policies(out)
    assert policies["clear"]["excludedJiras"] == ["B"]
    assert policies["clear"]["calibrationSize"] == sum(
        1 for r in with_answers(rows(4000)) if r["split"] == "calibration" and r["jira"] != "B"
    )


def test_grid_comes_from_train_scores_only():
    import numpy as np

    from hedge.calibrate import train_quantile_grid

    g = train_quantile_grid(np.r_[np.full(90, 0.95), np.linspace(0.0, 1.0, 10)], size=50)
    assert g.min() >= 0 and g.max() <= 1 and np.all(np.diff(g) > 0)
    assert (g >= 0.9).mean() < 1  # still spans the low scores
    with pytest.raises(ValueError):
        train_quantile_grid([0.5], size=1)


def test_certified_threshold_is_a_point_of_the_train_only_grid():
    import numpy as np

    from hedge.calibrate import train_quantile_grid
    from hedge.features import to_matrix
    from hedge.gate import fit_gate

    data = rows(6000)
    train = [r for r in data if r["split"] == "train"]
    model = fit_gate(to_matrix(train), [r["right"] for r in train], FEATURE_NAMES)
    grid = train_quantile_grid(model.predict_proba(to_matrix(train)))
    policy = build_policy(data, alpha=0.05, delta=0.1, retriever="bm25-v1")
    assert policy["calibrated"]
    assert np.isclose(grid, policy["threshold"], rtol=0, atol=1e-12).any()


def test_even_grid_is_still_available():
    policy = build_policy(rows(6000), alpha=0.05, delta=0.1, retriever="bm25-v1", grid_size=None)
    assert policy["calibrated"] and round(policy["threshold"] * 100) == policy["threshold"] * 100


def test_budget_table_certifies_each_budget_at_the_full_delta():
    budgets = (0.02, 0.05, 0.10)
    policy = build_policy(rows(6000), alpha=0.05, delta=0.1, retriever="bm25-v1", budgets=budgets)
    table = policy["budgets"]
    assert [b["alpha"] for b in table] == list(budgets)
    # The default budget is the table's own entry, so the dial and the default agree.
    entry = next(b for b in table if b["alpha"] == 0.05)
    assert entry["threshold"] == policy["threshold"]
    # A looser budget never acts on fewer tickets.
    covered = [b["calibrationCoverage"] for b in table]
    assert covered == sorted(covered)
    for b in table:
        if b["calibrated"]:
            assert b["calibrationErrors"] <= b["calibrationActed"]


def test_budget_table_costs_no_coverage_against_a_single_budget():
    single = build_policy(rows(6000), alpha=0.05, delta=0.1, retriever="bm25-v1")
    table = build_policy(rows(6000), alpha=0.05, delta=0.1, retriever="bm25-v1", budgets=(0.02, 0.05, 0.10))
    assert table["threshold"] == single["threshold"]
    assert table["calibrationCoverage"] == single["calibrationCoverage"]


def test_default_budget_must_be_in_the_table():
    with pytest.raises(ValueError, match="alpha"):
        build_policy(rows(600), alpha=0.03, delta=0.1, retriever="bm25-v1", budgets=(0.02, 0.05))


@pytest.mark.parametrize("budgets", [(), (0.05, 0.05), (0.05, 0.02), (0.0, 0.05), (0.05, 1.0)])
def test_bad_budget_tables_are_errors(budgets):
    with pytest.raises(ValueError):
        build_policy(rows(600), alpha=0.05, delta=0.1, retriever="bm25-v1", budgets=budgets)


def test_cli_writes_the_budget_table(tmp_path):
    path = tmp_path / "rows.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in with_answers(rows(4000))) + "\n")
    out = tmp_path / "policy.js"
    main([str(path), "--alpha", "0.05", "--budgets", "0.02,0.05,0.1", "--retriever", "bm25-v1", "--out", str(out)])
    policies = read_policies(out)
    assert [b["alpha"] for b in policies["clear"]["budgets"]] == [0.02, 0.05, 0.1]


def small_window_rows(n, seed=0, small=0.3):
    """rows(), with a share of tickets searching tiny windows and always wrong there."""
    out = rows(n, seed=seed)
    rng = np.random.default_rng(seed + 1)
    for r in out:
        r["window"] = int(rng.integers(0, 10)) if rng.uniform() < small else int(rng.integers(30, 1001))
        if r["window"] < 30:
            r["right"] = 0
    return out


def test_min_window_never_acts_on_a_small_window_ticket():
    data = small_window_rows(6000)
    policy = build_policy(data, alpha=0.05, delta=0.1, retriever="bm25-v1", min_window=30)
    assert policy["minWindow"] == 30
    assert policy["calibrated"] is True
    cal = [r for r in data if r["split"] == "calibration"]
    m = policy["model"]
    z = to_matrix(cal) @ np.array([m["weights"][n] for n in FEATURE_NAMES]) + m["bias"]
    scores = 1 / (1 + np.exp(-z))
    acted = [r for r, s in zip(cal, scores) if s >= policy["threshold"] and r["window"] >= 30]
    # Exactly the big-window tickets over the threshold are acted on; coverage is over all.
    assert policy["calibrationActed"] == len(acted)
    assert policy["calibrationCoverage"] == pytest.approx(len(acted) / len(cal))
    assert policy["calibrationErrors"] == sum(1 - r["right"] for r in acted)


def test_min_window_zero_is_the_old_policy_plus_the_field():
    data = small_window_rows(4000)
    old = build_policy(data, alpha=0.05, delta=0.1, retriever="bm25-v1")
    assert old["minWindow"] == 0
    assert old["threshold"] == build_policy(data, alpha=0.05, delta=0.1, retriever="bm25-v1", min_window=0)["threshold"]


def test_min_window_counts_small_windows_as_asked_in_every_budget():
    data = small_window_rows(6000)
    policy = build_policy(
        data, alpha=0.05, delta=0.1, retriever="bm25-v1", budgets=(0.03, 0.05, 0.1), min_window=30
    )
    big = sum(r["window"] >= 30 for r in data if r["split"] == "calibration")
    assert all(b["calibrationActed"] <= big for b in policy["budgets"])
    assert policy["minWindow"] == 30


@pytest.mark.parametrize("bad", [-1, 2.5, True, "30"])
def test_bad_min_window_is_an_error(bad):
    with pytest.raises(ValueError, match="min_window"):
        build_policy(rows(200), alpha=0.05, delta=0.1, retriever="bm25-v1", min_window=bad)


def test_min_window_needs_a_window_on_every_row():
    with pytest.raises(ValueError, match="integer window"):
        build_policy(rows(200), alpha=0.05, delta=0.1, retriever="bm25-v1", min_window=30)


def test_cli_records_the_min_window(tmp_path):
    src = tmp_path / "rows.jsonl"
    src.write_text("".join(json.dumps(r) + "\n" for r in with_answers(small_window_rows(2000))))
    out = tmp_path / "policy.js"
    assert main([str(src), "--retriever", "bm25-v1", "--alpha", "0.05", "--min-window", "30", "--out", str(out)]) == 0
    body = read_policies(out)
    assert body["link"]["minWindow"] == 30 and body["clear"]["minWindow"] == 30
