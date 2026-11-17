import gzip
import json
import pickle

import numpy as np
import pytest

from hedge.corpus import Corpus, earlier_copies


def rec(id_, created, dupes=(), summary=None, description="details", project=None):
    jira, key = id_.split(":")
    return {
        "id": id_,
        "key": key,
        "jira": jira,
        "project": project or key.split("-")[0],
        "created": created,
        "summary": summary if summary is not None else f"summary {key}",
        "description": description,
        "duplicates": list(dupes),
    }


def corpus(*records):
    return Corpus.from_records(records)


def test_rows_sorted_by_jira_project_and_time():
    c = corpus(rec("J:B-1", 30), rec("J:A-2", 20), rec("J:A-1", 10), rec("H:A-1", 50))
    assert c.ids.tolist() == ["H:A-1", "J:A-1", "J:A-2", "J:B-1"]
    assert c.group.tolist() == ["H/A", "J/A", "J/A", "J/B"]


def test_undated_issues_are_left_out_but_still_join_clusters():
    # X-2 is undated. X-1 and X-3 link only through it, so they share a cluster and the
    # closure makes X-1 the answer for X-3, but X-2 itself is never an answer.
    c = corpus(
        rec("J:X-1", 10, ["J:X-2"]),
        rec("J:X-2", None, ["J:X-1", "J:X-3"]),
        rec("J:X-3", 30, ["J:X-2"]),
    )
    assert c.ids.tolist() == ["J:X-1", "J:X-3"]
    assert c.cluster[0] == c.cluster[1] >= 0
    assert c.labels(0).tolist() == []
    assert c.ids[c.labels(1)].tolist() == ["J:X-1"]


def test_labels_are_earlier_cluster_members_as_row_indices():
    c = corpus(
        rec("J:X-1", 10, ["J:X-2"]),
        rec("J:X-2", 20, ["J:X-1", "J:X-3"]),
        rec("J:X-3", 30, ["J:X-2"]),
        rec("J:X-4", 40),
    )
    assert [c.ids[c.labels(i)].tolist() for i in range(4)] == [[], ["J:X-1"], ["J:X-1", "J:X-2"], []]
    assert c.has_label().tolist() == [False, True, True, False]
    assert c.cluster[3] == -1


def test_answer_text_is_stripped_from_summary_and_description():
    c = corpus(
        rec("J:X-1", 10),
        rec("J:X-2", 20, summary="Crash, duplicate of X-1", description="see x-1 and https://h/browse/X-1"),
    )
    assert "X-1" not in c.summary[1] and "duplicate of" not in c.summary[1]
    assert "x-1" not in c.text[1].lower() and "browse" not in c.text[1]


def test_long_descriptions_are_truncated():
    c = Corpus.from_records([rec("J:X-1", 10, description="word " * 1000)], max_description=50)
    assert len(c.text[0]) < 80


def test_repeated_ids_are_rejected():
    with pytest.raises(ValueError, match="unique"):
        corpus(rec("J:X-1", 10), rec("J:X-1", 20))


def test_copy_flag_checks_every_earlier_issue_in_any_project():
    c = corpus(
        rec("J:A-1", 10, summary="Same", description="Text"),
        rec("J:B-1", 20, summary="same", description="text!"),  # equal once normalized
        rec("J:A-2", 30, summary="different", description="text"),
    )
    assert dict(zip(c.ids.tolist(), c.copy.tolist())) == {"J:A-1": False, "J:B-1": True, "J:A-2": False}


def test_copies_need_a_strictly_earlier_original_and_some_text():
    t = np.array([5.0, 5.0, 6.0, 7.0])
    assert earlier_copies(["a b", "a b", "a b", ""], t).tolist() == [False, False, True, False]


def test_round_trip_through_jsonl_and_pickle(tmp_path):
    path = tmp_path / "issues.jsonl.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        for r in (rec("J:X-1", 10), rec("J:X-2", 20, ["J:X-1"])):
            f.write(json.dumps(r) + "\n")
    c = Corpus.from_jsonl(path)
    c.save(tmp_path / "c.pkl")
    back = Corpus.load(tmp_path / "c.pkl")
    assert back.ids.tolist() == c.ids.tolist()
    assert back.labels(1).tolist() == [0]


def test_load_rejects_other_pickles(tmp_path):
    p = tmp_path / "x.pkl"
    p.write_bytes(pickle.dumps({"not": "a corpus"}))
    with pytest.raises(TypeError):
        Corpus.load(p)


def test_a_cache_from_other_corpus_code_is_refused(tmp_path, monkeypatch):
    import hedge.corpus as corpus_module

    c = corpus(rec("J:X-1", 10))
    c.save(tmp_path / "c.pkl")
    assert not (tmp_path / "c.pkl.tmp").exists()
    monkeypatch.setattr(corpus_module, "code_stamp", lambda: "different")
    with pytest.raises(ValueError, match="rebuild"):
        Corpus.load(tmp_path / "c.pkl")
