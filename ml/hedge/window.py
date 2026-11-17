"""The deployed retriever: BM25 over the most recent earlier issues in the ticket's project.

A BM25 score depends on its corpus: IDF counts documents, and length normalization uses
the corpus's average length. A threshold certified on scores from one corpus does not
carry over to scores from another. The Forge app cannot hold a dataset-wide index. It can
fetch a project's recent issues through the Jira API, so that is the corpus Hedge
calibrates on: for a ticket created at time t, the ``WINDOW`` most recent issues of the
same project created strictly before t, indexed on their own. app/src/bm25.js computes the
same scores, and fixtures/bm25.json holds cases both test suites check. See ADR 4.

Corpus rows are sorted by (project, time), so a window is one contiguous slice of rows,
and a pre-tokenized corpus lets each window be scored with a few array operations
instead of re-indexing a thousand documents per query.
"""

from __future__ import annotations

from array import array
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from .bm25 import tokenize

WINDOW = 1000
K = 10
K1, B = 1.2, 0.75
RETRIEVER = f"bm25-recent{WINDOW}-v1"


@dataclass(frozen=True)
class TokenIndex:
    """Every document's tokens as ids into one vocabulary, in CSR form."""

    vocab: dict[str, int]
    ptr: np.ndarray  # document d's tokens are ids[ptr[d]:ptr[d + 1]]
    ids: np.ndarray

    @classmethod
    def build(cls, texts: Sequence[str]) -> TokenIndex:
        vocab: dict[str, int] = {}
        ptr, ids = array("q", [0]), array("i")
        for text in texts:
            ids.extend(vocab.setdefault(t, len(vocab)) for t in tokenize(text))
            ptr.append(len(ids))
        return cls(vocab, np.frombuffer(ptr, dtype=np.int64), np.frombuffer(ids, dtype=np.int32))

    def query(self, text: str) -> Counter:
        return Counter(j for t in tokenize(text) if (j := self.vocab.get(t)) is not None)


def window_bounds(starts: np.ndarray, created: np.ndarray, i: int, size: int = WINDOW) -> tuple[int, int]:
    """Rows [a, b): the ``size`` latest rows of i's group created strictly before row i.

    Needs rows sorted by (group, created), as ``hedge.corpus.Corpus`` keeps them, and
    ``starts`` from ``group_starts``.
    """
    if size < 1:
        raise ValueError("window size must be at least 1")
    start = int(starts[i])
    b = start + int(np.searchsorted(created[start:i], created[i], side="left"))
    return max(start, b - size), b


def group_starts(group: np.ndarray) -> np.ndarray:
    """For every row, the first row of its group (rows sorted by group)."""
    change = np.ones(group.size, dtype=bool)
    change[1:] = group[1:] != group[:-1]
    return np.maximum.accumulate(np.where(change, np.arange(group.size), 0))


def window_scores(index: TokenIndex, a: int, b: int, query: Counter, k1: float = K1, b_: float = B) -> np.ndarray:
    """BM25 scores of the query against documents a..b-1, indexed as their own corpus.

    Equal to ``BM25(k1, b).fit(texts[a:b]).scores(query_text)`` up to float rounding.
    """
    n = b - a
    if n <= 0:
        return np.zeros(0)
    if not query:
        return np.zeros(n)
    terms = np.fromiter(query.keys(), dtype=np.int32)
    order = np.argsort(terms)
    terms, qtf = terms[order], np.fromiter(query.values(), dtype=float)[order]
    lengths = np.diff(index.ptr[a : b + 1]).astype(float)
    toks = index.ids[index.ptr[a] : index.ptr[b]]
    rows = np.repeat(np.arange(n), lengths.astype(np.int64))
    hit = np.isin(toks, terms)
    pos = np.searchsorted(terms, toks[hit])
    tf = np.bincount(rows[hit] * terms.size + pos, minlength=n * terms.size).reshape(n, terms.size)
    df = (tf > 0).sum(axis=0)
    idf = np.log1p((n - df + 0.5) / (df + 0.5))
    avg = lengths.mean() if lengths.mean() > 0 else 1.0
    norm = k1 * (1 - b_ + b_ * lengths / avg)
    w = tf * (k1 + 1) / (tf + norm[:, None]) * idf
    return w @ qtf


def top_k(scores: np.ndarray, k: int = K) -> np.ndarray:
    """Positions of the k best positive scores, best first, ties to the lower position.

    Same rule as ``BM25.search``: a document sharing no term with the query is not a
    candidate, so fewer than k may come back.
    """
    cand = np.flatnonzero(scores > 0)
    return cand[np.lexsort((cand, -scores[cand]))[:k]]


@dataclass(frozen=True)
class Retrieved:
    rows: np.ndarray  # corpus rows of the top candidates, best first
    scores: np.ndarray
    window: int  # how many earlier issues were searched
    answer_in_window: bool  # whether any correct answer could have been found


def retrieve(corpus, index: TokenIndex, i: int, starts: np.ndarray, size: int = WINDOW, k: int = K) -> Retrieved:
    a, b = window_bounds(starts, corpus.created, i, size)
    s = window_scores(index, a, b, index.query(corpus.text[i]))
    top = top_k(s, k)
    labels = corpus.labels(i)
    return Retrieved(
        rows=top + a,
        scores=s[top],
        window=b - a,
        answer_in_window=bool(((labels >= a) & (labels < b)).any()),
    )
