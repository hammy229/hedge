"""Fit the gate, certify its threshold, and write the Forge policy.

Input is JSON Lines, one ticket per line:

    {"split": "train" | "calibration", "right": 0 or 1, "top1": ..., "margin": ..., ...}

``right`` says whether the action the agent would take (link its top candidate, or link
nothing) is correct. The gate is fit on train rows only and the threshold is certified on
calibration rows only, so the guarantee is not computed on data the model has seen.

Both actions (``ACTIONS``) are certified, each on its own, and written into one module:

    python -m hedge.calibrate ../data/rows.jsonl --retriever bm25-recent1000-v1 \\
        --alpha 0.03 --delta 0.1 --exclude-jira Mojang --out ../app/src/policy.js
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path

import numpy as np

from .features import FEATURE_NAMES, to_matrix
from .gate import fit_gate, policy_dict, write_policies
from .risk import DEFAULT_GRID, ltt_threshold


SPLITS = {"train", "calibration"}
GRID_SIZE = 200

# The two things an agent can do with a new ticket, each with its own gate and threshold.
#   link   link it as a duplicate of the top candidate; right when that candidate is one of
#          its earlier duplicates
#   clear  mark it as new, so nobody checks it for duplicates; right when it has no earlier
#          duplicate anywhere in the dataset (inside the window or not)
# On the real data linking is right for under 3% of tickets and clearing for over 85%, so
# the two need different evidence and get separate guarantees (ADR 5).
ACTIONS = ("link", "clear")


def for_action(rows: Iterable[dict], action: str) -> list[dict]:
    """Rows whose ``right`` says whether ``action`` is correct for that ticket."""
    if action not in ACTIONS:
        raise ValueError(f"action must be one of {ACTIONS}, got {action!r}")
    if action == "link":
        return list(rows)
    return [{**r, "right": int(not r["has_answer"])} for r in rows]


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
    action: str = "link",
    budgets: Sequence[float] | None = None,
    min_window: int = 0,
) -> dict:
    """Fit on train rows, certify on calibration rows, for one action (see ``ACTIONS``).

    The threshold grid comes from train scores (``train_quantile_grid``). Pass
    ``grid_size=None`` for the even 101-point grid on [0, 1].

    A row may carry ``group`` (its duplicate cluster or project). When any calibration row
    does, errors are counted per group and tested with a bound that holds under any
    dependence inside a group (``risk.clustered_p_value``). Rows without a group count as
    their own group.

    Pass ``budgets`` to also certify a table of error budgets for the admin's dial, every
    one at the full ``delta``. The grid tests are Bonferroni-corrected and each p-value only
    falls as the budget grows, so each grid test is an upper confidence bound on that
    threshold's error, and one event of probability 1 - delta covers every budget at once.
    The admin may pick any row after seeing the table, with no split of delta (ADR 7).
    ``alpha`` must be one of the budgets: it is the default, and the top-level threshold
    is its table entry.

    ``min_window`` makes the gate ask about every ticket that searched fewer earlier issues
    than that, whatever its score (ADR 8). The rule is applied before certification: those
    calibration tickets count as asked, never as acted, so the certified error rate is the
    error rate of the rule the app runs. The policy records it as ``minWindow``.
    """
    if isinstance(min_window, bool) or not isinstance(min_window, int) or min_window < 0:
        raise ValueError(f"min_window must be a non-negative integer, got {min_window!r}")
    if budgets is not None:
        budgets = check_budgets(budgets, alpha)
    rows = list(rows)
    for i, r in enumerate(rows):
        if action == "clear" and not isinstance(r.get("has_answer"), bool):
            raise ValueError(f"row {i}: the clear action needs a boolean has_answer")
        if r.get("split") not in SPLITS:
            raise ValueError(f"row {i}: split must be one of {sorted(SPLITS)}, got {r.get('split')!r}")
        if r.get("right") not in (0, 1):
            raise ValueError(f"row {i}: right must be 0 or 1, got {r.get('right')!r}")
        if min_window > 0 and (isinstance(r.get("window"), bool) or not isinstance(r.get("window"), int)):
            raise ValueError(f"row {i}: a minimum window needs an integer window, got {r.get('window')!r}")
    rows = for_action(rows, action)
    train = [r for r in rows if r["split"] == "train"]
    cal = [r for r in rows if r["split"] == "calibration"]
    if not train or not cal:
        raise ValueError("need both train and calibration rows")
    model = fit_gate(to_matrix(train), [r["right"] for r in train], FEATURE_NAMES, l2=l2)
    grid = DEFAULT_GRID if grid_size is None else train_quantile_grid(model.predict_proba(to_matrix(train)), grid_size)
    scores = model.predict_proba(to_matrix(cal))
    if min_window > 0:
        # Too-small windows score 0 and the grid starts above 0, so no threshold acts on them.
        scores = np.where([r["window"] < min_window for r in cal], 0.0, scores)
        grid = grid[grid > 0]
    wrong = 1 - np.asarray([r["right"] for r in cal])
    groups = None
    if any("group" in r for r in cal):
        groups = [str(r.get("group", f"__row{i}")) for i, r in enumerate(cal)]
    size = len(cal)
    if budgets is None:
        threshold = ltt_threshold(scores, wrong, alpha=alpha, delta=delta, grid=grid, groups=groups)
        return {"action": action, **policy_dict(model, threshold, alpha, delta, size, retriever, min_window)}
    table = []
    for a in budgets:
        t = ltt_threshold(scores, wrong, alpha=a, delta=delta, grid=grid, groups=groups)
        calibrated = bool(np.isfinite(t.threshold))
        table.append(
            {
                "alpha": a,
                "calibrated": calibrated,
                "threshold": float(t.threshold) if calibrated else None,
                "calibrationCoverage": t.coverage,
                "calibrationActed": t.acted,
                "calibrationErrors": t.errors,
            }
        )
        if a == alpha:
            default = t
    policy = policy_dict(model, default, alpha, delta, size, retriever, min_window)
    return {"action": action, **policy, "budgets": table}


def check_budgets(budgets: Sequence[float], alpha: float) -> tuple[float, ...]:
    """Budgets must be distinct, increasing, inside (0, 1) and include the default alpha."""
    b = tuple(float(x) for x in budgets)
    if not b:
        raise ValueError("budgets must not be empty")
    if any(not 0 < x < 1 for x in b):
        raise ValueError(f"every budget must be inside (0, 1), got {b}")
    if any(y <= x for x, y in zip(b, b[1:])):
        raise ValueError(f"budgets must be strictly increasing, got {b}")
    if alpha not in b:
        raise ValueError(f"the default alpha {alpha} must be one of the budgets {b}")
    return b


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("rows", type=Path, help="JSON Lines file of feature rows")
    ap.add_argument("--alpha", type=float, default=0.03, help="error budget among acted tickets")
    ap.add_argument("--delta", type=float, default=0.1, help="allowed chance the bound fails")
    ap.add_argument("--retriever", required=True, help="id of the retriever that produced the scores")
    ap.add_argument("--exclude-jira", action="append", default=[], help="leave a Jira out of fitting and calibration")
    ap.add_argument(
        "--budgets",
        type=lambda v: tuple(float(x) for x in v.split(",")),
        default=None,
        help="comma-separated budgets for the admin dial, e.g. 0.01,0.02,0.03,0.05,0.1 (must include --alpha)",
    )
    ap.add_argument("--min-window", type=int, default=0, help="ask about tickets that searched fewer earlier issues (ADR 8)")
    ap.add_argument("--l2", type=float, default=1.0)
    ap.add_argument("--out", type=Path, required=True, help="where to write policy.js")
    args = ap.parse_args(argv)
    excluded = sorted(set(args.exclude_jira))
    with args.rows.open() as f:
        rows = [r for line in f if line.strip() and (r := json.loads(line)).get("jira") not in excluded]
    unknown = {r.get("split") for r in rows} - SPLITS - {"test"}
    if unknown:
        raise SystemExit(f"unknown split names {sorted(map(str, unknown))}; nothing was written")
    rows = [r for r in rows if r["split"] in SPLITS]
    policies = {}
    for action in ACTIONS:
        policy = build_policy(
            rows, args.alpha, args.delta, args.retriever, args.l2, action=action, budgets=args.budgets,
            min_window=args.min_window,
        )
        policies[action] = {**policy, "excludedJiras": excluded}
        if policy["calibrated"]:
            print(
                f"{action}: threshold {policy['threshold']:.3f}, acts on "
                f"{policy['calibrationCoverage']:.1%} of {policy['calibrationSize']} calibration tickets"
            )
        else:
            print(f"{action}: nothing certified at this budget, so this gate asks about every ticket")
    write_policies(policies, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
