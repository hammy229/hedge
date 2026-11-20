import json

import numpy as np
import pytest

from hedge.corpus import Corpus
from hedge.features import FEATURE_NAMES
from hedge.rows import fresh_part, main, make_rows, query_split
from hedge.window import TokenIndex


def rec(id_, created, dupes=(), summary="x", description=""):
    jira, key = id_.split(":")
    return {
        "id": id_, "key": key, "jira": jira, "project": key.split("-")[0], "created": created,
        "summary": summary, "description": description, "duplicates": list(dupes),
    }


def small():
    return Corpus.from_records([
        rec("J:A-1", 1, ["J:A-3"], "login page crashes on submit", "trace"),
        rec("J:A-2", 2, [], "dark mode colors are wrong"),
        rec("J:A-3", 3, ["J:A-1"], "crash when submitting login page"),
        rec("J:A-4", 4, [], "dark mode colors are off"),  # no duplicate: linking is wrong
        rec("J:A-5", 5, [], "something no one has said"),
    ])


def rows_for(c, ids):
    pick = np.array([c.ids.tolist().index(k) for k in ids])
    return {r["id"]: r for r in make_rows(c, TokenIndex.build(c.text), {"test": pick})}


def test_right_only_when_the_top_candidate_is_an_earlier_duplicate():
    c = small()
    rows = rows_for(c, ["J:A-3", "J:A-4", "J:A-5", "J:A-1"])
    assert rows["J:A-3"]["right"] == 1 and rows["J:A-3"]["rank"] == 1
    # A-4's top candidate is A-2 (same words), but A-4 duplicates nothing.
    assert rows["J:A-4"]["right"] == 0 and not rows["J:A-4"]["has_answer"]
    assert rows["J:A-5"]["right"] == 0 and rows["J:A-5"]["top1"] == 0.0
    assert rows["J:A-1"]["window"] == 0 and rows["J:A-1"]["right"] == 0


def test_rows_carry_every_gate_feature_and_a_cluster_group():
    c = small()
    rows = rows_for(c, ["J:A-3", "J:A-2"])
    for r in rows.values():
        assert set(FEATURE_NAMES) <= r.keys()
    assert rows["J:A-3"]["group"].startswith("c")
    assert rows["J:A-2"]["group"].startswith("r")
    assert rows["J:A-3"]["hasDescription"] == 0.0


def test_rows_record_creation_time_and_the_top_match_context():
    c = small()
    rows = rows_for(c, ["J:A-3", "J:A-5"])
    a3 = rows["J:A-3"]
    assert a3["created"] == 3.0
    assert a3["logWindow"] == pytest.approx(np.log1p(2))  # A-1 and A-2 came before
    assert 0 < a3["summaryOverlap"] < 1  # top match A-1 shares login, page
    assert a3["logTopAgeDays"] == pytest.approx(np.log1p(2 / 86400))  # A-1 is two seconds older
    assert rows["J:A-5"]["summaryOverlap"] == 0.0 and rows["J:A-5"]["logTopAgeDays"] == 0.0


def test_query_split_drops_copies_from_every_part():
    records = [rec(f"J:A-{i}", i, summary=f"issue {i}") for i in range(1, 41)]
    records.append(rec("J:A-99", 99, summary="issue 1"))  # copy of A-1, lands in test
    c = Corpus.from_records(records)
    split, info = query_split(c)
    copy_row = c.ids.tolist().index("J:A-99")
    assert copy_row not in np.concatenate([split.train, split.calibration, split.test])
    assert info["copies_dropped"]["test"] == 1


def test_main_writes_rows_and_meta(tmp_path):
    # Unique texts: repeated ones would be dropped as copies of an earlier issue.
    records = [rec(f"J:A-{i}", i, summary=f"bug {i} in module {i % 5}") for i in range(1, 61)]
    c = Corpus.from_records(records)
    c.save(tmp_path / "c.pkl")
    out = tmp_path / "rows.jsonl"
    assert main([str(tmp_path / "c.pkl"), "--out", str(out), "--per-split", "5"]) == 0
    rows = [json.loads(line) for line in out.read_text().splitlines()]
    assert {r["split"] for r in rows} == {"train", "calibration", "test"}
    meta = json.loads(out.with_suffix(".meta.json").read_text())
    assert meta["retriever"] == "bm25-recent1000-v1" and meta["sampled"]["test"] == 5


def test_train_keeps_rows_that_share_a_cluster_with_later_parts():
    # Dropping them would let calibration and test labels (the final Duplicate links) pick
    # the gate's training data.
    records = [rec(f"J:A-{i}", i, summary=f"issue {i}") for i in range(1, 41)]
    records[0]["duplicates"] = ["J:A-40"]
    records[-1]["duplicates"] = ["J:A-1"]
    c = Corpus.from_records(records)
    split, _ = query_split(c)
    assert c.ids.tolist().index("J:A-1") in split.train


def test_fresh_part_drops_old_tickets_and_their_whole_clusters():
    c = small()
    part = np.arange(len(c))
    a1 = c.ids.tolist().index("J:A-1")
    old = [{"id": "J:A-1", "group": f"c{c.cluster[a1]}"}, {"id": "J:A-2", "group": "r1"}]
    left = {c.ids[i] for i in fresh_part(c, part, old)}
    # A-3 shares A-1's cluster, A-2 is an old ticket; A-4 and A-5 are untouched.
    assert left == {"J:A-4", "J:A-5"}


def test_main_fresh_calibration_keeps_train_and_test_and_redraws_calibration(tmp_path):
    records = [rec(f"J:A-{i}", i, summary=f"bug {i} in module {i % 5}") for i in range(1, 201)]
    Corpus.from_records(records).save(tmp_path / "c.pkl")
    first = tmp_path / "rows.jsonl"
    assert main([str(tmp_path / "c.pkl"), "--out", str(first), "--per-split", "10"]) == 0
    second = tmp_path / "rows2.jsonl"
    assert main([str(tmp_path / "c.pkl"), "--out", str(second), "--per-split", "10", "--seed", "1",
                 "--fresh-calibration", str(first)]) == 0
    a = [json.loads(line) for line in first.read_text().splitlines()]
    b = [json.loads(line) for line in second.read_text().splitlines()]
    keep = lambda rows: [r for r in rows if r["split"] != "calibration"]  # noqa: E731
    assert keep(a) == keep(b)
    old = {r["id"] for r in a if r["split"] == "calibration"}
    new = {r["id"] for r in b if r["split"] == "calibration"}
    assert len(new) == 10 and not old & new
    meta = json.loads(second.with_suffix(".meta.json").read_text())
    assert meta["fresh_from"] == str(first) and meta["calibration_left_after_exclusion"] > 0
