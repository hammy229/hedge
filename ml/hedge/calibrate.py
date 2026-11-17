"""Fit the gate, certify its threshold, and write the Forge policy.

Input is JSON Lines, one ticket per line:

    {"split": "train" | "calibration", "right": 0 or 1, "top1": ..., "margin": ..., ...}

``right`` says whether the action the agent would take (link its top candidate, or link
nothing) is correct. The gate is fit on train rows only and the threshold is certified on
calibration rows only, so the guarantee is not computed on data the model has seen.

    python -m hedge.calibrate rows.jsonl --retriever bm25-v1 --alpha 0.03 --delta 0.1 \\
        --out ../app/src/policy.js
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable
from pathlib import Path

import numpy as np

from .features import FEATURE_NAMES, to_matrix
from .gate import fit_gate, policy_dict, write_policy
from .risk import DEFAULT_GRID, ltt_threshold


SPLITS = {"train", "calibration"}
GRID_SIZE = 200


def train_quantile_grid(train_scores, size: int = GRID_SIZE) -> np.ndarray:
    """Threshold grid at quantiles of the gate's scores on *train* rows.

    Learn then Test needs the grid fixed before it sees calibration data, not fixed
    forever, so train data may shape it. An even grid on [0, 1] wastes its points: a
    gate's probabilities bunch up (on the real data, most sit between 0.9 and 1.0), and
    with steps of 0.01 the most lenient certified threshold jumped from acting on 9.9% to
    5.5% of tickets between two neighbors. Quantiles put the points where the scores are.
    """
    if size < 2:
        raise ValueError("grid size must be at least 2")
    s = np.asarray(train_scores, dtype=float)
    q = np.quantile(s, np.linspace(0, 1, size))
    return np.unique(np.clip(q, 0.0, 1.0))


def build_policy(
    rows: Iterable[dict],
    alpha: float,
    delta: float,
    retriever: str,
    l2: float = 1.0,
    grid_size: int | None = GRID_SIZE,
) -> dict:
    """Fit on train rows, certify on calibration rows.

    The threshold grid comes from train scores (``train_quantile_grid``). Pass
    ``grid_size=None`` for the even 101-point grid on [0, 1].

    A row may carry ``group`` (its duplicate cluster or project). When any calibration row
    does, the threshold is certified on one row per group, because correlated rows would
    otherwise make the test overconfident. Rows without a group count as their own group.
    """
    rows = list(rows)
    for i, r in enumerate(rows):
        if r.get("split") not in SPLITS:
            raise ValueError(f"row {i}: split must be one of {sorted(SPLITS)}, got {r.get('split')!r}")
        if r.get("right") not in (0, 1):
            raise ValueError(f"row {i}: right must be 0 or 1, got {r.get('right')!r}")
    train = [r for r in rows if r["split"] == "train"]
    cal = [r for r in rows if r["split"] == "calibration"]
    if not train or not cal:
        raise ValueError("need both train and calibration rows")
    model = fit_gate(to_matrix(train), [r["right"] for r in train], FEATURE_NAMES, l2=l2)
    grid = DEFAULT_GRID if grid_size is None else train_quantile_grid(model.predict_proba(to_matrix(train)), grid_size)
    scores = model.predict_proba(to_matrix(cal))
    wrong = 1 - np.asarray([r["right"] for r in cal])
    groups = None
    if any("group" in r for r in cal):
        groups = [str(r.get("group", f"__row{i}")) for i, r in enumerate(cal)]
    threshold = ltt_threshold(scores, wrong, alpha=alpha, delta=delta, grid=grid, groups=groups)
    size = len(set(groups)) if groups else len(cal)
    return policy_dict(model, threshold, alpha, delta, size, retriever)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("rows", type=Path, help="JSON Lines file of feature rows")
    ap.add_argument("--alpha", type=float, default=0.03, help="error budget among acted tickets")
    ap.add_argument("--delta", type=float, default=0.1, help="allowed chance the bound fails")
    ap.add_argument("--retriever", required=True, help="id of the retriever that produced the scores, e.g. bm25-v1")
    ap.add_argument("--l2", type=float, default=1.0)
    ap.add_argument("--out", type=Path, required=True, help="where to write policy.js")
    args = ap.parse_args(argv)
    with args.rows.open() as f:
        rows = [json.loads(line) for line in f if line.strip()]
    policy = build_policy(rows, args.alpha, args.delta, args.retriever, args.l2)
    write_policy(policy, args.out)
    if policy["calibrated"]:
        print(
            f"threshold {policy['threshold']:.3f}, acts on "
            f"{policy['calibrationCoverage']:.1%} of {policy['calibrationSize']} calibration tickets"
        )
    else:
        print("no threshold certified at this budget: the gate will ask about every ticket")
    return 0


if __name__ == "__main__":
    sys.exit(main())
