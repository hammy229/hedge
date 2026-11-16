"""BM25 retrieval over issue text: the baseline every learned retriever must beat.

The index stores one precomputed BM25 weight per (document, term) in a column-major sparse
matrix, so scoring a query only touches the columns of its own terms. ``search`` can hide
the query itself and every issue filed at or after a given time, because a new ticket can
only be a duplicate of tickets that already exist.
"""

from __future__ import annotations

import re
from array import array
from collections import Counter
from collections.abc import Iterable, Sequence

import numpy as np
from scipy import sparse

TOKEN = re.compile(r"[a-z0-9]+(?:[._][a-z0-9]+)*")


def tokenize(text: str) -> list[str]:
    """Lowercase word tokens. Keeps dotted and underscored names (FileSystem.open, max_len)."""
    return TOKEN.findall(text.lower())


class BM25:
    def __init__(self, k1: float = 1.2, b: float = 0.75) -> None:
        self.k1, self.b = k1, b
        self.vocab: dict[str, int] = {}
        self.weights: sparse.csc_matrix | None = None
        self.created: np.ndarray | None = None

    def fit(self, docs: Sequence[str], created: Sequence[float] | None = None) -> BM25:
        """Index docs. Pass ``created`` (one time per doc) to allow ``search(before=...)``.

        Postings go into typed arrays, not Python lists, so a few million issues fit in a
        few hundred MB instead of several GB.
        """
        if created is not None and len(created) != len(docs):
            raise ValueError("created must have one time per document")
        indptr, indices, counts = array("q", [0]), array("i"), array("d")
        for doc in docs:
            tf = Counter(self.vocab.setdefault(tok, len(self.vocab)) for tok in tokenize(doc))
            indices.extend(tf.keys())
            counts.extend(tf.values())
            indptr.append(len(indices))
        n, v = len(docs), len(self.vocab)
        indptr_a = np.frombuffer(indptr, dtype=np.int64)
        cols = np.frombuffer(indices, dtype=np.int32)
        tf = np.frombuffer(counts, dtype=float)
        rows = np.repeat(np.arange(n), np.diff(indptr_a))
        lengths = np.bincount(rows, weights=tf, minlength=n)
        df = np.bincount(cols, minlength=v)
        idf = np.log1p((n - df + 0.5) / (df + 0.5))  # Lucene's always-positive variant
        avg = lengths.mean() if n and lengths.mean() > 0 else 1.0
        norm = self.k1 * (1 - self.b + self.b * lengths / avg)
        w = tf * (self.k1 + 1) / (tf + norm[rows]) * idf[cols]
        self.weights = sparse.csr_matrix((w, cols, indptr_a), shape=(n, v)).tocsc()
        self.created = None if created is None else np.asarray(created, dtype=float)
        return self

    def scores(self, query: str) -> np.ndarray:
        if self.weights is None:
            raise RuntimeError("call fit() first")
        q = Counter(j for tok in tokenize(query) if (j := self.vocab.get(tok)) is not None)
        if not q:
            return np.zeros(self.weights.shape[0])
        ids = np.fromiter(q.keys(), dtype=np.int64)
        return np.asarray(self.weights[:, ids] @ np.fromiter(q.values(), dtype=float)).ravel()

    def search(
        self,
        query: str,
        k: int = 10,
        mask: np.ndarray | None = None,
        before: float | None = None,
        exclude: int | Iterable[int] | None = None,
    ) -> list[tuple[int, float]]:
        """Top-k (index, score) pairs, best first. Equal scores go to the lower index.

        Only documents sharing at least one term with the query (score above 0) are
        returned, so fewer than k may come back. A zero-score document is not a candidate
        duplicate, and keeping them would make every tie at 0 a fake neighbor.

        mask     only documents where mask is True
        before   only documents created strictly before this time (needs fit(created=...))
        exclude  document indices to leave out, such as the query's own index
        """
        s = self.scores(query)
        allowed = np.ones(s.size, dtype=bool) if mask is None else np.asarray(mask, dtype=bool).copy()
        if before is not None:
            if self.created is None:
                raise ValueError("search(before=...) needs fit(created=...)")
            allowed &= self.created < before
        if exclude is not None:
            allowed[np.asarray([exclude] if np.isscalar(exclude) else list(exclude), dtype=int)] = False
        cand = np.flatnonzero(allowed & (s > 0))
        if k <= 0 or cand.size == 0:
            return []
        if cand.size > k:
            kth = np.partition(s[cand], cand.size - k)[cand.size - k]
            cand = cand[s[cand] >= kth]  # keeps every tie at the cut, settled below
        top = cand[np.lexsort((cand, -s[cand]))[:k]]
        return [(int(i), float(s[i])) for i in top]
