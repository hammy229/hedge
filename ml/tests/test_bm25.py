import math

import numpy as np
import pytest

from hedge.bm25 import BM25, tokenize
from hedge.metrics import mean_reciprocal_rank, recall_at_k

DOCS = [
    "NullPointerException in FileSystem.open when path is empty",
    "Add dark mode to the settings page",
    "FileSystem.open throws NPE on empty path",
    "Upgrade the build to Java 21",
]


def test_tokenize_keeps_code_names():
    assert tokenize("NPE in FileSystem.open, max_len=3!") == ["npe", "in", "filesystem.open", "max_len", "3"]


def test_finds_the_duplicate_first():
    index = BM25().fit(DOCS)
    top = index.search("NPE thrown by FileSystem.open for an empty path", k=2)
    assert {top[0][0], top[1][0]} == {0, 2}
    assert top[0][1] >= top[1][1]


def test_mask_hides_later_issues():
    index = BM25().fit(DOCS)
    mask = np.array([False, True, False, True])
    assert all(i in (1, 3) for i, _ in index.search("FileSystem.open empty path", mask=mask))


def test_empty_mask_and_unknown_words():
    index = BM25().fit(DOCS)
    assert index.search("anything", mask=np.zeros(4, dtype=bool)) == []
    assert np.all(index.scores("zzzz qqqq") == 0)


def test_rare_terms_weigh_more_than_common_ones():
    index = BM25().fit(["the cat", "the dog", "the bird", "the zebra"])
    assert index.scores("zebra")[3] > index.scores("the")[3]


def test_requires_fit():
    with pytest.raises(RuntimeError):
        BM25().scores("x")


def test_retrieval_metrics_by_hand():
    ranked = [["a", "b", "c"], ["x", "y", "z"], ["p", "q"]]
    relevant = [{"b"}, {"z"}, set()]
    assert recall_at_k(ranked, relevant, k=1) == 0.0
    assert recall_at_k(ranked, relevant, k=3) == 1.0
    assert mean_reciprocal_rank(ranked, relevant) == pytest.approx((1 / 2 + 1 / 3) / 2)
    assert math.isnan(recall_at_k([["a"]], [set()], k=1))


def test_exclude_drops_the_query_itself():
    index = BM25().fit(DOCS)
    top = index.search(DOCS[0], k=4, exclude=0)
    assert 0 not in [i for i, _ in top] and top[0][0] == 2
    assert index.search(DOCS[0], k=4, exclude=[0, 2]) == []  # nothing else shares a term


def test_before_only_returns_older_issues():
    index = BM25().fit(DOCS, created=[10, 20, 30, 40])
    assert {i for i, _ in index.search("FileSystem.open empty path", k=4, before=30)} == {0}  # 2 is too new, 1 shares no term
    assert index.search("anything", before=10) == []
    with pytest.raises(ValueError):
        BM25().fit(DOCS).search("x", before=1.0)
    with pytest.raises(ValueError):
        BM25().fit(DOCS, created=[1, 2])


def test_ties_go_to_the_lower_index():
    index = BM25().fit(["same words"] * 6)
    assert [i for i, _ in index.search("same words", k=3)] == [0, 1, 2]
    assert [i for i, _ in index.search("same words", k=3, exclude=1)] == [0, 2, 3]


def test_empty_documents_get_zero_length():
    index = BM25().fit(["", "cat", "", "cat dog"])
    s = index.scores("cat")
    assert s[0] == 0 and s[2] == 0 and s[1] > s[3] > 0


def test_matches_a_direct_bm25_formula():
    docs = ["a b b c", "b c", "c c c d", "a"]
    index = BM25(k1=1.5, b=0.6).fit(docs)
    toks = [d.split() for d in docs]
    avg = sum(map(len, toks)) / len(toks)

    def direct(q, d):
        total = 0.0
        for term in set(q.split()):
            df = sum(term in t for t in toks)
            idf = math.log1p((len(toks) - df + 0.5) / (df + 0.5))
            f = d.count(term)
            total += q.split().count(term) * idf * f * 2.5 / (f + 1.5 * (1 - 0.6 + 0.6 * len(d) / avg))
        return total

    np.testing.assert_allclose(index.scores("b c a"), [direct("b c a", t) for t in toks])


def test_trailing_empty_document_and_zero_scores():
    index = BM25().fit(["a b", "c d", ""])  # an empty last doc used to crash the build
    assert index.search("a") == [(0, index.scores("a")[0])]
    assert index.search("qqq unknown") == []
