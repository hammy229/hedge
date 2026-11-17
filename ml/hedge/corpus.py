"""Load the slim issue records into column arrays for retrieval and evaluation.

``hedge.extract`` writes one JSON object per issue. Retrieval needs them in a different
shape: sorted by project and creation time, so "the issues filed in this project before
this ticket" is a contiguous slice, with labels as row indices instead of id strings.

Only issues with a known creation time enter the corpus. An issue whose time is unknown
cannot be placed before or after a query, so it can be neither a query nor a candidate
(docs/data.md, "Impossible creation dates").

    corpus = Corpus.from_jsonl("../data/issues.jsonl.gz")
    corpus.save("../data/corpus.pkl")
"""

from __future__ import annotations

import gzip
import hashlib
import json
import pickle
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .dupes import duplicate_clusters, duplicate_labels
from .leakage import normalize, strip_answer_text

# Long descriptions are mostly stack traces and logs. The first 2,000 characters hold the
# report itself and keep the corpus in memory on a laptop.
MAX_DESCRIPTION = 2000


@dataclass
class Corpus:
    """One row per dated issue, sorted by (jira, project, created, id).

    ``group`` is "jira/project", since project keys repeat across Jiras. ``cluster`` is the
    duplicate cluster's number, or -1 for an issue in no cluster. ``labels(i)`` gives the
    rows that are correct answers for row i (its earlier duplicates). ``copy`` marks rows
    whose normalized text already appeared in an earlier issue anywhere in the dataset.
    """

    ids: np.ndarray
    jira: np.ndarray
    group: np.ndarray
    created: np.ndarray
    summary: list[str]
    text: list[str]
    cluster: np.ndarray
    label_ptr: np.ndarray
    label_idx: np.ndarray
    copy: np.ndarray

    def __len__(self) -> int:
        return self.ids.size

    def labels(self, i: int) -> np.ndarray:
        return self.label_idx[self.label_ptr[i] : self.label_ptr[i + 1]]

    def has_label(self) -> np.ndarray:
        return np.diff(self.label_ptr) > 0

    @classmethod
    def from_records(cls, records: Iterable[dict], max_description: int = MAX_DESCRIPTION) -> Corpus:
        rows = [r for r in records if r.get("created") is not None]
        rows.sort(key=lambda r: (r["jira"], r["project"] or "", r["created"], r["id"]))
        ids = [r["id"] for r in rows]
        index = {k: i for i, k in enumerate(ids)}
        if len(index) != len(ids):
            raise ValueError("issue ids must be unique")
        created = np.array([r["created"] for r in rows], dtype=float)
        links = {(min(r["id"], b), max(r["id"], b)) for r in rows for b in r["duplicates"]}
        # Endpoints outside the corpus (dangling links, unknown dates) still join clusters,
        # as docs/data.md describes, but can never be an answer.
        times = {k: created[i] for k, i in index.items()}
        labels = duplicate_labels(links, times)
        cluster = np.full(len(rows), -1, dtype=np.int32)
        for c, members in enumerate(sorted(duplicate_clusters(links), key=min)):
            for k in members:
                if k in index:
                    cluster[index[k]] = c
        ptr = np.zeros(len(rows) + 1, dtype=np.int64)
        idx: list[int] = []
        for i, k in enumerate(ids):
            idx.extend(sorted(index[a] for a in labels.get(k, ())))
            ptr[i + 1] = len(idx)
        keys = {r["project"] for r in rows if r["project"]}
        summary = [strip_answer_text(r["summary"], keys) for r in rows]
        text = [
            s + "\n" + strip_answer_text(r["description"][:max_description], keys)
            for s, r in zip(summary, rows, strict=True)
        ]
        return cls(
            ids=np.array(ids, dtype=object),
            jira=np.array([r["jira"] for r in rows], dtype=object),
            group=np.array([f"{r['jira']}/{r['project']}" for r in rows], dtype=object),
            created=created,
            summary=summary,
            text=text,
            cluster=cluster,
            label_ptr=ptr,
            label_idx=np.array(idx, dtype=np.int64),
            copy=earlier_copies(text, created, keys),
        )

    @classmethod
    def from_jsonl(cls, path: str | Path, max_description: int = MAX_DESCRIPTION) -> Corpus:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return cls.from_records((json.loads(line) for line in f), max_description)

    def save(self, path: str | Path) -> None:
        with open(path, "wb") as f:
            pickle.dump(self, f, protocol=pickle.HIGHEST_PROTOCOL)

    @staticmethod
    def load(path: str | Path) -> Corpus:
        # Only for caches this package wrote locally. Never load a pickle from elsewhere.
        with open(path, "rb") as f:
            corpus = pickle.load(f)
        if not isinstance(corpus, Corpus):
            raise TypeError(f"{path} does not hold a Corpus")
        return corpus


def earlier_copies(texts: list[str], created: np.ndarray, project_keys=None) -> np.ndarray:
    """Mark texts whose normalized form appeared in an issue created strictly earlier.

    This checks the whole earlier corpus, not only one split's queries: a ticket pasted
    from any older issue is an easy match for any retriever and says nothing about how
    the gate does on genuinely new reports. Empty texts are never copies, and issues
    created at the same second as the first occurrence are not either.
    """
    order = np.lexsort((np.arange(len(texts)), created))
    first: dict[bytes, float] = {}
    out = np.zeros(len(texts), dtype=bool)
    for i in order:
        n = normalize(texts[i], project_keys)
        if not n:
            continue
        t0 = first.setdefault(hashlib.sha1(n.encode()).digest(), created[i])
        out[i] = t0 < created[i]
    return out
