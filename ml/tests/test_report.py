import json

import numpy as np

from hedge.report import main, report, to_markdown


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
