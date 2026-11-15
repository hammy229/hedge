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
