"""Fit the gate, certify its threshold, and write the Forge policy.

Input is JSON Lines, one ticket per line:

    {"split": "train" | "calibration", "right": 0 or 1, "top1": ..., "margin": ..., ...}

``right`` says whether the action the agent would take (link its top candidate, or link
nothing) is correct. The gate is fit on train rows only and the threshold is certified on
calibration rows only, so the guarantee is not computed on data the model has seen.

    python -m hedge.calibrate rows.jsonl --alpha 0.03 --delta 0.1 --out ../app/src/policy.js
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
from .risk import ltt_threshold


def build_policy(rows: Iterable[dict], alpha: float, delta: float, l2: float = 1.0) -> dict:
    rows = list(rows)
    train = [r for r in rows if r["split"] == "train"]
    cal = [r for r in rows if r["split"] == "calibration"]
    if not train or not cal:
        raise ValueError("need both train and calibration rows")
    model = fit_gate(to_matrix(train), [r["right"] for r in train], FEATURE_NAMES, l2=l2)
    scores = model.predict_proba(to_matrix(cal))
    wrong = 1 - np.asarray([r["right"] for r in cal])
    threshold = ltt_threshold(scores, wrong, alpha=alpha, delta=delta)
    return policy_dict(model, threshold, alpha, delta, len(cal))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("rows", type=Path, help="JSON Lines file of feature rows")
    ap.add_argument("--alpha", type=float, default=0.03, help="error budget among acted tickets")
    ap.add_argument("--delta", type=float, default=0.1, help="allowed chance the bound fails")
    ap.add_argument("--l2", type=float, default=1.0)
    ap.add_argument("--out", type=Path, required=True, help="where to write policy.js")
    args = ap.parse_args(argv)
    with args.rows.open() as f:
        rows = [json.loads(line) for line in f if line.strip()]
    policy = build_policy(rows, args.alpha, args.delta, args.l2)
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
