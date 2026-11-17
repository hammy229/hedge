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
import os
import pickle
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .dupes import duplicate_clusters, duplicate_labels
from .leakage import normalize, strip_answer_text

# Long descriptions are mostly stack traces and logs. The first 1,000 characters hold the
# report itself and keep 2.7M issues in a laptop's memory. app/src/bm25.js cuts the same way.
MAX_DESCRIPTION = 1000


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
    def from_records(
        cls,
        records: Iterable[dict],
        max_description: int = MAX_DESCRIPTION,
        project_keys: Iterable[str] | None = None,
    ) -> Corpus:
        """Build from slim records. Each record is cut down as it is read, so the full
        descriptions never pile up in memory.

        ``project_keys`` lets answer text be stripped during the read. Without it the
        keys come from the records themselves, after reading.
        """
        keys = frozenset(project_keys) if project_keys is not None else None
        strip = (lambda t: strip_answer_text(t, keys)) if keys is not None else (lambda t: t)
        rows = [
            (r["jira"], r["project"] or "", r["created"], r["id"], tuple(r["duplicates"]),
             strip(r["summary"]), strip(r["description"][:max_description]))
            for r in records
            if r.get("created") is not None
        ]
        rows.sort(key=lambda r: r[:4])
        if keys is None:
            keys = frozenset(r[1] for r in rows if r[1])
            rows = [(*r[:5], *retrieval_parts(r[5], r[6], keys)) for r in rows]
        ids = [r[3] for r in rows]
        index = {k: i for i, k in enumerate(ids)}
        if len(index) != len(ids):
            raise ValueError("issue ids must be unique")
        created = np.array([r[2] for r in rows], dtype=float)
        links = {(min(r[3], b), max(r[3], b)) for r in rows for b in r[4]}
        # Endpoints outside the corpus (dangling links, unknown dates) still join clusters,
        # as docs/data.md describes, but can never be an answer.
        times = dict(zip(ids, created.tolist()))  # floats, not 2.7M numpy scalars
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
        jira = np.array([r[0] for r in rows], dtype=object)
        group = np.array([f"{r[0]}/{r[1]}" for r in rows], dtype=object)
        summary = [r[5] for r in rows]
        text = [r[5] + "\n" + r[6] for r in rows]
        del rows
        return cls(
            ids=np.array(ids, dtype=object),
            jira=jira,
            group=group,
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
        """Two passes: a cheap scan for project keys, then the real read."""
        with gzip.open(path, "rt", encoding="utf-8") as f:
            keys = {p for line in f if (p := json.loads(line).get("project"))}
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return cls.from_records((json.loads(line) for line in f), max_description, keys)

    def save(self, path: str | Path) -> None:
        """Write the cache with a stamp of the code that made it, atomically, so a crash
        never leaves a truncated cache at ``path``."""
        path = Path(path)
        tmp = path.with_name(path.name + ".tmp")
        with open(tmp, "wb") as f:
            pickle.dump((code_stamp(), self), f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, path)

    @staticmethod
    def load(path: str | Path) -> Corpus:
        """Read a cache this package wrote locally. Never load a pickle from elsewhere:
        unpickling runs code, and no check afterwards can undo that.

        Refuses a cache made by different text or label code (a changed description cut,
        stripping rule or cluster rule), because rows built from it would no longer match
        what fixtures/bm25.json and the app compute.
        """
        with open(path, "rb") as f:
            stored = pickle.load(f)
        if not (isinstance(stored, tuple) and len(stored) == 2 and isinstance(stored[1], Corpus)):
            raise TypeError(f"{path} does not hold a Corpus cache")
        stamp, corpus = stored
        if stamp != code_stamp():
            raise ValueError(f"{path} was built by different corpus code; rebuild it with Corpus.from_jsonl")
        return corpus


def code_stamp() -> str:
    """Hash of the sources that decide retrieval text and labels, plus the description cut."""
    here = Path(__file__).resolve().parent
    h = hashlib.sha256(str(MAX_DESCRIPTION).encode())
    for name in ("corpus.py", "leakage.py", "dupes.py"):
        h.update((here / name).read_bytes())
    return h.hexdigest()


def retrieval_parts(
    summary: str, description: str, project_keys, max_description: int = MAX_DESCRIPTION
) -> tuple[str, str]:
    """The summary and description exactly as retrieval sees them: answer text stripped,
    description cut at ``max_description`` code points. app/src/text.js does the same."""
    return (
        strip_answer_text(summary, project_keys),
        strip_answer_text(description[:max_description], project_keys),
    )


def retrieval_text(summary: str, description: str, project_keys, max_description: int = MAX_DESCRIPTION) -> str:
    s, d = retrieval_parts(summary, description, project_keys, max_description)
    return s + "\n" + d


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
