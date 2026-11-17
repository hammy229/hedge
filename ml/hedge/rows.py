"""Turn sampled tickets into gate rows: retrieval features, the action's outcome, the split.

The agent's action on a ticket is "link it as a duplicate of the top candidate". The
action is right when that candidate is one of the ticket's earlier duplicates, and wrong
otherwise, including for every ticket that duplicates nothing (most tickets). Rows are the
input of ``hedge.calibrate`` and ``hedge.report``.

    python -m hedge.rows ../data/corpus.pkl --out ../data/rows.jsonl --per-split 20000

Splits are temporal (train, then calibration, then test, by creation time), made cluster
disjoint by dropping train rows, and every ticket whose text copies an earlier issue is
left out of the queries. The retrieval corpus is not split: a test ticket is searched
against everything its project filed before it, as the app would do.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from .corpus import Corpus
from .features import gate_features
from .splits import Split, cluster_disjoint, quantile_temporal_split
from .window import K, RETRIEVER, WINDOW, TokenIndex, group_starts, retrieve


def query_split(corpus: Corpus, cal_frac: float = 0.15, test_frac: float = 0.15) -> tuple[Split, dict]:
    split = quantile_temporal_split(corpus.created, cal_frac, test_frac)
    groups = [int(c) if c >= 0 else None for c in corpus.cluster]
    split, dropped = cluster_disjoint(split, groups)
    keep = lambda part: part[~corpus.copy[part]]  # noqa: E731
    out = Split(keep(split.train), keep(split.calibration), keep(split.test))
    info = {
        "train_dropped_shared_cluster": dropped["train"],
        "copies_dropped": {n: int(getattr(split, n).size - getattr(out, n).size) for n in ("train", "calibration", "test")},
    }
    return out, info


def sample(part: np.ndarray, n: int | None, rng: np.random.Generator) -> np.ndarray:
    if n is None or part.size <= n:
        return part
    return np.sort(rng.choice(part, size=n, replace=False))


def description(text: str) -> str:
    return text.partition("\n")[2]


def make_rows(
    corpus: Corpus, index: TokenIndex, queries: dict[str, np.ndarray], size: int = WINDOW, k: int = K
) -> Iterator[dict]:
    starts = group_starts(corpus.group)
    for name, rows in queries.items():
        for i in rows.tolist():
            got = retrieve(corpus, index, i, starts, size=size, k=k)
            labels = set(corpus.labels(i).tolist())
            ranked = got.rows.tolist()
            rank = next((r for r, j in enumerate(ranked, start=1) if j in labels), None)
            yield {
                "split": name,
                "id": corpus.ids[i],
                "jira": corpus.jira[i],
                "project": corpus.group[i],
                "group": f"c{corpus.cluster[i]}" if corpus.cluster[i] >= 0 else f"r{i}",
                "right": int(rank == 1),
                "has_answer": bool(labels),
                "answer_in_window": got.answer_in_window,
                "rank": rank,
                "window": got.window,
                **gate_features(got.scores, corpus.summary[i], description(corpus.text[i])),
            }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("corpus", type=Path, help="pickle written by Corpus.save")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--per-split", type=int, default=20000, help="queries sampled per split (0 = all)")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)
    start = time.monotonic()
    corpus = Corpus.load(args.corpus)
    index = TokenIndex.build(corpus.text)
    print(f"indexed {len(corpus):,} issues in {time.monotonic() - start:.0f} s", file=sys.stderr)
    split, info = query_split(corpus)
    rng = np.random.default_rng(args.seed)
    n = args.per_split or None
    queries = {name: sample(getattr(split, name), n, rng) for name in ("train", "calibration", "test")}
    with args.out.open("w") as f:
        for r in make_rows(corpus, index, queries):
            f.write(json.dumps(r) + "\n")
    meta = {
        "retriever": RETRIEVER,
        "split_sizes": split.sizes(),
        "sampled": {k: int(v.size) for k, v in queries.items()},
        "seed": args.seed,
        **info,
        "seconds": round(time.monotonic() - start, 1),
    }
    args.out.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(json.dumps(meta))
    return 0


if __name__ == "__main__":
    sys.exit(main())
