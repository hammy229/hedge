"""Pick the retriever's summary weight on training duplicates only.

For each weight, every sampled training ticket that has an earlier duplicate inside its
window is searched, and the report gives how often the duplicate ranks first (hit@1),
anywhere in the top K (hit@K), and the mean reciprocal rank. Calibration and test tickets
play no part, so the weight chosen here can still be certified on them.

    python -m hedge.sweep data/corpus.pkl --out data/sweep.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Iterable
from pathlib import Path

import numpy as np

from .corpus import Corpus
from .rows import query_split, sample
from .window import K, TokenIndex, group_starts, retrieve, window_bounds

WEIGHTS = (1, 2, 3, 4, 5)


def answerable(corpus: Corpus, rows: np.ndarray, starts: np.ndarray) -> np.ndarray:
    """The rows whose earlier duplicate falls inside their window: the ones a retriever can get."""
    keep = []
    for i in rows.tolist():
        a, b = window_bounds(starts, corpus.created, i)
        labels = corpus.labels(i)
        keep.append(bool(((labels >= a) & (labels < b)).any()))
    return rows[np.array(keep, dtype=bool)] if rows.size else rows


def ranks(corpus: Corpus, index: TokenIndex, rows: Iterable[int], starts: np.ndarray, k: int = K) -> list[int | None]:
    out = []
    for i in rows:
        got = retrieve(corpus, index, i, starts, k=k)
        labels = set(corpus.labels(i).tolist())
        out.append(next((r for r, j in enumerate(got.rows.tolist(), start=1) if j in labels), None))
    return out


def summarize(found: list[int | None], k: int = K) -> dict:
    n = len(found)
    if n == 0:
        return {"queries": 0, "hit1": None, f"hit{k}": None, "mrr": None}
    return {
        "queries": n,
        "hit1": sum(r == 1 for r in found) / n,
        f"hit{k}": sum(r is not None for r in found) / n,
        "mrr": sum(1 / r for r in found if r) / n,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("corpus", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--queries", type=int, default=5000, help="training duplicates sampled per group")
    ap.add_argument("--weights", type=int, nargs="+", default=list(WEIGHTS))
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)
    start = time.monotonic()
    corpus = Corpus.load(args.corpus)
    split, _ = query_split(corpus)
    starts = group_starts(corpus.group)
    rng = np.random.default_rng(args.seed)
    train = split.train[corpus.has_label()[split.train]]
    mojang = corpus.jira[train] == "Mojang"
    groups = {
        "without Mojang": answerable(corpus, sample(train[~mojang], args.queries, rng), starts),
        "Mojang": answerable(corpus, sample(train[mojang], args.queries, rng), starts),
    }
    report = {"split": "train", "seed": args.seed, "k": K, "weights": {}}
    for w in args.weights:
        index = TokenIndex.build(corpus.text, summary_weight=w)
        report["weights"][str(w)] = {g: summarize(ranks(corpus, index, rows.tolist(), starts)) for g, rows in groups.items()}
        print(json.dumps({"weight": w, **report["weights"][str(w)]}), file=sys.stderr, flush=True)
    report["seconds"] = round(time.monotonic() - start, 1)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
