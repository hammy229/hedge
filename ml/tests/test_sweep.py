import json

import numpy as np

from hedge.corpus import Corpus
from hedge.sweep import answerable, main, ranks, summarize
from hedge.window import TokenIndex, group_starts


def rec(id_, created, dupes=(), summary="x", description=""):
    jira, key = id_.split(":")
    return {
        "id": id_, "key": key, "jira": jira, "project": key.split("-")[0], "created": created,
        "summary": summary, "description": description, "duplicates": list(dupes),
    }


def corpus():
    # A-3 restates A-1's title; A-2 shares A-3's long description, so the description
    # outvotes the title unless the title counts more.
    return Corpus.from_records([
        rec("J:A-1", 1, ["J:A-3"], "login crash", "x"),
        rec("J:A-2", 2, [], "dark mode", "token refresh fails when proxy rewrites header"),
        rec("J:A-3", 3, ["J:A-1"], "login crash", "token refresh fails when proxy rewrites header"),
    ])


def test_title_weight_moves_the_restated_title_up():
    c = corpus()
    starts = group_starts(c.group)
    i = c.ids.tolist().index("J:A-3")
    assert ranks(c, TokenIndex.build(c.text), [i], starts) == [2]
    assert ranks(c, TokenIndex.build(c.text, summary_weight=4), [i], starts) == [1]


def test_answerable_drops_tickets_whose_duplicate_is_later():
    c = corpus()
    starts = group_starts(c.group)
    rows = np.array([c.ids.tolist().index(k) for k in ("J:A-1", "J:A-3")])
    assert [c.ids[i] for i in answerable(c, rows, starts)] == ["J:A-3"]


def test_summarize_counts_hits_and_reciprocal_ranks():
    got = summarize([1, 2, None, 1])
    assert got == {"queries": 4, "hit1": 0.5, "hit10": 0.75, "mrr": (1 + 0.5 + 1) / 4}
    assert summarize([])["hit1"] is None


def test_main_writes_one_entry_per_weight(tmp_path):
    # Enough tickets that every temporal split has some; each odd one restates the one before.
    recs = []
    for n in range(1, 41):
        dupes = [f"J:A-{n - 1}"] if n % 2 == 0 else [f"J:A-{n + 1}"]
        recs.append(rec(f"J:A-{n}", n, dupes, f"topic{(n + 1) // 2} fails", f"words {n}"))
    path = tmp_path / "c.pkl"
    Corpus.from_records(recs).save(path)
    out = tmp_path / "sweep.json"
    assert main([str(path), "--out", str(out), "--weights", "1", "2"]) == 0
    report = json.loads(out.read_text())
    assert set(report["weights"]) == {"1", "2"}
    assert report["split"] == "train"
