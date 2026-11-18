import json

import numpy as np

from hedge.report import hold_out_projects, main, mature, report, to_markdown


def rows(n=3000, seed=0):
    """Margin predicts both actions: a big margin means a found duplicate, a tiny top
    score means a new report."""
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        dup = rng.uniform() < 0.2
        margin = rng.exponential(3.0 if dup else 0.5)
        top1 = rng.normal(8 if dup else 3, 1)
        out.append({
            "split": ("train", "calibration", "test")[i % 3],
            "jira": "J",
            "project": f"J/P{i % 40}",
            "group": f"r{i}",
            "has_answer": bool(dup),
            "right": int(dup and margin > 2),
            "top1": top1, "margin": margin, "entropy": float(np.exp(-margin)),
            "summaryWords": 8.0, "hasDescription": 1.0,
            "logWindow": float(np.log1p(1000)), "summaryOverlap": float(dup) * 0.5, "logTopAgeDays": 1.0,
            "created": float(i),
        })
    return out


def test_report_certifies_on_calibration_and_measures_test():
    result = report(rows(), alphas=(0.05, 0.2), n_boot=50)
    assert result["n_test"] == 1000 and set(result["actions"]) == {"link", "clear"}
    clear = result["actions"]["clear"]
    assert abs(clear["base_error"] - 0.2) < 0.05
    for c in clear["certified"]:
        if c["calibrated"]:
            point, lo, hi = c["test_error"]
            assert lo <= point <= hi
    md = to_markdown(result)
    assert "| clear | 5% |" in md and "BM25 top score" in md


def test_main_writes_json_and_markdown_and_can_drop_a_jira(tmp_path):
    data = rows(1500) + [r | {"jira": "Other"} for r in rows(300, seed=1)]
    path = tmp_path / "rows.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in data))
    out = tmp_path / "report.json"
    assert main([str(path), "--out", str(out), "--exclude-jira", "Other", "--n-boot", "20"]) == 0
    result = json.loads(out.read_text())
    assert result["n_test"] == 500 and result["excluded_jiras"] == ["Other"]
    assert out.with_suffix(".md").read_text().startswith("| Action |")


def test_verdict_needs_the_whole_interval_under_budget_and_enough_tickets():
    from hedge.report import verdict

    base = {"alpha": 0.05, "test_acted": 500}
    assert verdict(base | {"test_error": (0.02, 0.01, 0.04)}) == "yes"
    assert verdict(base | {"test_error": (0.04, 0.02, 0.07)}) == "unclear"
    assert verdict(base | {"test_error": (0.08, 0.06, 0.10)}) == "no"
    assert verdict({"alpha": 0.05, "test_acted": 3, "test_error": (0.0, 0.0, 0.0)}).startswith("too few")


def test_bootstrap_drops_resamples_where_the_statistic_is_undefined():
    from hedge.metrics import cluster_bootstrap_ci

    acted = np.array([True, False, False, False])
    wrong = np.array([True, False, False, False])

    def risk(i):
        a = acted[i]
        return float(wrong[i][a].mean()) if a.any() else float("nan")

    point, lo, hi = cluster_bootstrap_ci(risk, clusters=[0, 1, 2, 3], n_boot=200)
    assert point == 1.0 and lo == 1.0 and hi == 1.0  # empty draws never pull it toward 0


def test_mature_drops_only_test_tickets_too_new_to_have_their_links():
    data = rows(300)
    last = max(r["created"] for r in data)
    kept = mature(data, days=100 / 86400)
    assert all(r["split"] != "test" or r["created"] <= last - 100 for r in kept)
    assert [r for r in kept if r["split"] != "test"] == [r for r in data if r["split"] != "test"]
    assert len(kept) < len(data)
    assert mature(data, days=0) == data


def test_held_out_projects_never_reach_fitting_and_are_all_test_sees():
    data = rows(3000)
    out, held = hold_out_projects(data, frac=0.25, seed=1)
    assert 0 < len(held) < 40
    assert all((r["project"] in held) == (r["split"] == "test") for r in out)
    assert {r["project"] for r in out if r["split"] == "test"} == held
    again, held_again = hold_out_projects(data, frac=0.25, seed=1)
    assert held_again == held and again == out
    result = report(out, alphas=(0.2,), n_boot=20)
    assert result["test_projects"] == len(held)


def test_mature_cut_can_be_pinned_to_the_dump_time():
    data = rows(300)
    pinned = mature(data, days=10 / 86400, last=1e9)
    assert pinned == data  # nothing is within 10 s of a dump far in the future


def test_held_out_clusters_leave_fitting_entirely():
    data = rows(3000)
    for i, r in enumerate(data):
        r["group"] = f"c{i % 7}"  # clusters that cross every project
    out, held = hold_out_projects(data, frac=0.25, seed=1)
    assert all(r["split"] == "test" for r in out)  # every cluster reached test
