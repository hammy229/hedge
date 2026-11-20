import gzip
import json

import pytest

from hedge.seed import main, pick_span, scrub, seed_records


def rec(key, created, dupes=(), summary=None, description=""):
    return {
        "id": f"J:{key}", "key": key, "jira": "J", "project": key.split("-")[0], "created": created,
        "summary": summary or f"issue {key}", "description": description, "duplicates": [f"J:{d}" for d in dupes],
    }


def history(n=40):
    return [rec(f"P-{i}", float(i)) for i in range(1, n + 1)]


def test_pick_span_takes_the_latest_span_with_enough_duplicate_tickets():
    issues = history()
    issues[4]["duplicates"] = ["J:P-2"]  # P-5 duplicates P-2: inside spans starting at <= 1
    issues[30]["duplicates"] = ["J:P-29"]  # P-31 duplicates P-29
    issues[35]["duplicates"] = ["J:P-33"]  # P-36 duplicates P-33
    span = pick_span(issues, size=10, min_duplicates=2)
    # The latest 10-issue span holding both pairs starts at P-29, the earliest original.
    assert [r["key"] for r in span] == [f"P-{i}" for i in range(29, 39)]


def test_pick_span_counts_only_duplicates_whose_original_is_earlier_in_the_span():
    issues = history(20)
    issues[19]["duplicates"] = ["J:P-1"]  # original outside any 5-issue span with P-20
    with pytest.raises(ValueError, match="no span"):
        pick_span(issues, size=5, min_duplicates=1)


def test_pick_span_sorts_by_time_not_input_order():
    issues = list(reversed(history(12)))
    issues[0]["duplicates"] = ["J:P-11"]  # P-12 duplicates P-11
    span = pick_span(issues, size=4, min_duplicates=1)
    assert [r["key"] for r in span] == ["P-9", "P-10", "P-11", "P-12"]


def test_scrub_removes_keys_links_and_duplicate_phrasing_but_keeps_lines():
    text = "Same as P-12, see https://jira.example.com/browse/P-12\nDuplicate of P-3.\nUTF-8 is fine"
    out = scrub(text, ["P"])
    assert "P-12" not in out and "P-3" not in out and "browse" not in out
    assert "uplicate of" not in out
    assert "UTF-8 is fine" in out and "\n" in out


def test_seed_records_number_duplicates_by_position_and_cut_descriptions():
    span = [rec("P-1", 1.0, description="x" * 5000), rec("P-2", 2.0, ["P-1"]), rec("P-3", 3.0, ["P-9"])]
    out = seed_records(span)
    assert [r["source"] for r in out] == ["P-1", "P-2", "P-3"]
    assert [r["duplicateOf"] for r in out] == [[], [0], []]
    assert len(out[0]["description"]) == 1000


def test_main_writes_an_importable_module_with_attribution(tmp_path):
    issues = history(30)
    issues[29]["duplicates"] = ["J:P-28"]
    issues.append({**rec("Q-1", 50.0), "project": "Q"})
    src = tmp_path / "issues.jsonl.gz"
    with gzip.open(src, "wt") as f:
        for r in issues:
            f.write(json.dumps(r) + "\n")
    out = tmp_path / "seed.js"
    assert main([str(src), "--jira", "J", "--project", "P", "--size", "10", "--min-duplicates", "1", "--out", str(out)]) == 0
    text = out.read_text()
    assert "CC BY 4.0" in text and "Montgomery" in text
    body = json.loads(text.split("export default ", 1)[1].rstrip().rstrip(";"))
    assert body["source"]["project"] == "P" and len(body["issues"]) == 10
    assert body["issues"][-1]["source"] == "P-30" and body["issues"][-1]["duplicateOf"] == [7]
