"""BM25 retrieval over issue text: the baseline every learned retriever must beat.

The index stores one precomputed BM25 weight per (document, term), so scoring a query is a
sparse matrix times a query-term vector. ``search`` takes a candidate mask so a new issue
is only matched against issues filed before it, which is how triage works in real life.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

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
        self.weights: sparse.csr_matrix | None = None

    def fit(self, docs: Sequence[str]) -> BM25:
        rows, cols, vals = [], [], []
        lengths = np.zeros(len(docs))
        for i, doc in enumerate(docs):
            counts: dict[int, int] = {}
            for tok in tokenize(doc):
                j = self.vocab.setdefault(tok, len(self.vocab))
                counts[j] = counts.get(j, 0) + 1
            lengths[i] = sum(counts.values())
            rows += [i] * len(counts)
            cols += list(counts)
            vals += list(counts.values())
        n, v = len(docs), len(self.vocab)
        tf = sparse.csr_matrix((vals, (rows, cols)), shape=(n, v), dtype=float)
        df = np.bincount(cols, minlength=v)
        idf = np.log1p((n - df + 0.5) / (df + 0.5))  # Lucene's always-positive variant
        avg = lengths.mean() if n and lengths.mean() > 0 else 1.0
        norm = self.k1 * (1 - self.b + self.b * lengths / avg)
        tf = tf.tocoo()
        w = tf.data * (self.k1 + 1) / (tf.data + norm[tf.row]) * idf[tf.col]
        self.weights = sparse.csr_matrix((w, (tf.row, tf.col)), shape=(n, v))
        return self

    def scores(self, query: str) -> np.ndarray:
        if self.weights is None:
            raise RuntimeError("call fit() first")
        q = np.zeros(len(self.vocab))
        for tok in tokenize(query):
            j = self.vocab.get(tok)
            if j is not None:
                q[j] += 1
        return self.weights @ q

    def search(self, query: str, k: int = 10, mask: np.ndarray | None = None):
        """Top-k (index, score) pairs, best first, among documents where mask is True."""
        s = self.scores(query)
        if mask is not None:
            s = np.where(mask, s, -np.inf)
        k = min(k, int(np.isfinite(s).sum()))
        if k == 0:
            return []
        top = np.argpartition(-s, k - 1)[:k]
        top = top[np.argsort(-s[top], kind="stable")]
        return [(int(i), float(s[i])) for i in top]
