import numpy as np
import pytest

from hedge.bm25 import BM25
from hedge.corpus import Corpus
from hedge.window import TokenIndex, group_starts, retrieve, top_k, window_bounds, window_scores

WORDS = "crash npe login timeout ui render cache leak thread deadlock java python api".split()


def random_texts(rng, n):
    return [" ".join(rng.choice(WORDS, size=rng.integers(0, 12))) for _ in range(n)]


@pytest.mark.parametrize("seed", range(20))
def test_window_scores_equal_a_bm25_index_built_on_the_window(seed):
    rng = np.random.default_rng(seed)
    texts = random_texts(rng, 60)
    index = TokenIndex.build(texts)
    a, b = sorted(rng.choice(61, size=2, replace=False))
    query = " ".join(rng.choice(WORDS, size=5))
    want = BM25().fit(texts[a:b]).scores(query) if b > a else np.zeros(0)
    got = window_scores(index, a, b, index.query(query))
    np.testing.assert_allclose(got, want, rtol=1e-12, atol=1e-12)


def test_window_scores_handle_empty_window_and_empty_query():
    index = TokenIndex.build(["a b", "c"])
    assert window_scores(index, 1, 1, index.query("a")).size == 0
    assert window_scores(index, 0, 2, index.query("zzz")).tolist() == [0.0, 0.0]


def test_window_is_strictly_earlier_same_group_and_capped():
    group = np.array(["p", "p", "p", "p", "q", "q"], dtype=object)
    created = np.array([1.0, 2.0, 2.0, 3.0, 1.0, 5.0])
    starts = group_starts(group)
    assert starts.tolist() == [0, 0, 0, 0, 4, 4]
    assert window_bounds(starts, created, 3, size=10) == (0, 3)
    assert window_bounds(starts, created, 3, size=2) == (1, 3)
    # Row 2 was created at the same second as row 1, so row 1 is not "before" it.
    assert window_bounds(starts, created, 2, size=10) == (0, 1)
    assert window_bounds(starts, created, 4, size=10) == (4, 4)
    assert window_bounds(starts, created, 5, size=10) == (4, 5)
    with pytest.raises(ValueError):
        window_bounds(starts, created, 3, size=0)


def test_top_k_drops_zero_scores_and_breaks_ties_by_position():
    s = np.array([0.0, 2.0, 1.0, 2.0, 0.5])
    assert top_k(s, 3).tolist() == [1, 3, 2]
    assert top_k(np.zeros(4), 3).size == 0


def rec(id_, created, dupes=(), summary="x"):
    jira, key = id_.split(":")
    return {
        "id": id_, "key": key, "jira": jira, "project": key.split("-")[0], "created": created,
        "summary": summary, "description": "", "duplicates": list(dupes),
    }


def test_retrieve_finds_an_earlier_duplicate_and_reports_the_window():
    c = Corpus.from_records([
        rec("J:A-1", 1, ["J:A-3"], "login page crashes on submit"),
        rec("J:A-2", 2, summary="dark mode colors"),
        rec("J:A-3", 3, ["J:A-1"], "crash when submitting the login page"),
        rec("J:B-1", 0, summary="login page crashes on submit"),  # other project, never searched
    ])
    index = TokenIndex.build(c.text)
    i = c.ids.tolist().index("J:A-3")
    got = retrieve(c, index, i, group_starts(c.group))
    assert c.ids[got.rows[0]] == "J:A-1"
    assert got.window == 2 and got.answer_in_window
    assert "J:B-1" not in c.ids[got.rows].tolist()


def test_answer_outside_the_window_is_reported():
    c = Corpus.from_records([
        rec("J:A-1", 1, ["J:A-3"], "login crash"),
        rec("J:A-2", 2, summary="dark mode"),
        rec("J:A-3", 3, ["J:A-1"], "login crash"),
    ])
    index = TokenIndex.build(c.text)
    got = retrieve(c, index, 2, group_starts(c.group), size=1)
    assert got.window == 1 and not got.answer_in_window
