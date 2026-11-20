"""Certify each action on calibration rows, then check the guarantee on the later test window.

For every action (link, clear) and error budget alpha, the gate is fit on train rows and
its threshold certified on calibration rows (``hedge.calibrate.build_policy``). The test
rows, created after every calibration row, then show what the threshold does under drift:
the error rate among acted tickets, and how many tickets it acted on. Intervals resample
whole projects, since tickets from one project are correlated.

A second table ranks the confidence signals with no certification: the gate's probability
against the raw BM25 top score, the obvious signal an agent would use on its own.

    python -m hedge.report ../data/rows.jsonl --out ../data/report.json
    python -m hedge.report ../data/rows.jsonl --out ../data/report-no-mojang.json --exclude-jira Mojang

``--mature-days`` checks how much late labels matter, and ``--holdout-projects`` tests on
projects the gate never saw.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

import numpy as np
from scipy.special import expit

from .calibrate import ACTIONS, build_policy, for_action
from .evaluate import _fmt, evaluate_method
from .features import FEATURE_NAMES, to_matrix
from .metrics import cluster_bootstrap_ci
from .window import RETRIEVER

ALPHAS = (0.01, 0.03, 0.05, 0.1)
# Below this many acted test tickets an error rate says little, so the verdict is withheld.
MIN_ACTED = 30


def verdict(c: dict) -> str:
    """Within budget only when the interval's upper end is; unclear when just the point is."""
    if c["test_acted"] < MIN_ACTED:
        return f"too few acted ({c['test_acted']})"
    point, _, hi = c["test_error"]
    if hi <= c["alpha"]:
        return "yes"
    return "unclear" if point <= c["alpha"] else "no"


DAY = 86400.0


def mature(rows: list[dict], days: float, last: float | None = None) -> list[dict]:
    """Drop test tickets created in the last ``days`` before the dump, taken to be ``last``
    or, if not given, the newest ticket in ``rows``. Pass ``last`` when ``rows`` has been
    filtered, so leaving out a Jira cannot move the cut.

    Labels are the Duplicate links in the dump. A ticket filed a week before the dump has
    had a week to be linked, so its "no duplicate" label is less settled than one filed a
    year before, and the clear action's test error looks lower than it is. Running the
    report with and without this cut shows how much that matters. Train and calibration
    tickets are years older and are kept.
    """
    if days <= 0:
        return rows
    if last is None:
        last = max(r["created"] for r in rows)
    cut = last - days * DAY
    return [r for r in rows if r["split"] != "test" or r["created"] <= cut]


def hold_out_projects(rows: list[dict], frac: float, seed: int = 0) -> tuple[list[dict], set[str]]:
    """Pick ``frac`` of the projects with test tickets at random, keep them out of fitting
    and calibration, and test only on them.

    The temporal split tests on later tickets from projects the gate has seen. A judge
    installs Hedge on a site it has never seen, so this split asks the harder question: do
    the thresholds hold on projects that contributed nothing to them?
    """
    if not 0 < frac < 1:
        raise ValueError("frac must be in (0, 1)")
    project = lambda r: r["project"] or ""  # noqa: E731
    projects = sorted({project(r) for r in rows if r["split"] == "test"})
    rng = np.random.default_rng(seed)
    n = max(1, round(frac * len(projects)))
    held = set(rng.choice(projects, size=n, replace=False).tolist())
    out = [r for r in rows if (project(r) in held) == (r["split"] == "test")]
    # A duplicate cluster can span projects. Its fitted members would carry information
    # about its held-out ones, so fitting rows of any cluster that reaches test are dropped.
    tested = {r["group"] for r in out if r["split"] == "test" and str(r["group"]).startswith("c")}
    out = [r for r in out if r["split"] == "test" or r["group"] not in tested]
    return out, held


def gate_scores(policy: dict, rows: Sequence[dict]) -> np.ndarray:
    m = policy["model"]
    w = np.array([m["weights"][n] for n in FEATURE_NAMES])
    return expit(to_matrix(rows) @ w + m["bias"])


def baseline_scores(action: str, rows: Sequence[dict]) -> np.ndarray:
    """Raw BM25 top score: link when it is high, clear when it is low."""
    top1 = np.array([r["top1"] for r in rows], dtype=float)
    return top1 if action == "link" else -top1


def report(
    rows: list[dict], alphas=ALPHAS, delta: float = 0.1, n_boot: int = 1000, seed: int = 0, min_window: int = 0
) -> dict:
    fit_rows = [r for r in rows if r["split"] != "test"]
    test = [r for r in rows if r["split"] == "test"]
    if not test:
        raise ValueError("no test rows")
    projects = [r["project"] for r in test]
    out: dict = {
        "n_test": len(test),
        "test_projects": len(set(projects)),
        "delta": delta,
        "min_window": min_window,
        "alphas": list(alphas),
        "actions": {},
    }
    if min_window and any(isinstance(r.get("window"), bool) or not isinstance(r.get("window"), int) for r in test):
        raise ValueError("a minimum window needs an integer window on every test row")
    windows = np.array([r["window"] if min_window else 0 for r in test])
    for action in ACTIONS:
        wrong = np.array([1 - r["right"] for r in for_action(test, action)], dtype=float)
        certified = []
        probs = None
        for alpha in alphas:
            policy = build_policy(fit_rows, alpha, delta, RETRIEVER, action=action, min_window=min_window)
            probs = gate_scores(policy, test)  # same model for every alpha
            row = {
                "alpha": alpha,
                "calibrated": policy["calibrated"],
                "threshold": policy["threshold"],
                "calibration_coverage": policy["calibrationCoverage"],
                "calibration_size": policy["calibrationSize"],
            }
            if policy["calibrated"]:
                t = policy["threshold"]
                # The app asks below the minimum window whatever the score (ADR 8).
                act = (probs >= t) & (windows >= min_window)

                def risk(i, act=act):
                    a = act[i]
                    return float(wrong[i][a].mean()) if a.any() else float("nan")

                boot = dict(clusters=projects, n_boot=n_boot, seed=seed)
                row["test_coverage"] = cluster_bootstrap_ci(lambda i, act=act: float(act[i].mean()), **boot)
                row["test_error"] = cluster_bootstrap_ci(risk, **boot)
                row["test_acted"] = int(act.sum())
            certified.append(row)
        ranking = {
            # Both signals rank tickets below the minimum window last, as the app never acts on them.
            "Hedge gate": evaluate_method(np.where(windows >= min_window, probs, -np.inf), wrong, projects, alphas, n_boot=n_boot, seed=seed),
            "BM25 top score": evaluate_method(np.where(windows >= min_window, baseline_scores(action, test), -np.inf), wrong, projects, alphas, n_boot=n_boot, seed=seed),
        }
        out["actions"][action] = {"base_error": float(wrong.mean()), "certified": certified, "ranking": ranking}
    return out


def to_markdown(result: dict) -> str:
    lines = [
        "| Action | Budget | Certified on calibration | Test coverage | Acted | Test error | Within budget (95% CI) |",
        "|---|---|---|---|---|---|---|",
    ]
    for action, a in result["actions"].items():
        for c in a["certified"]:
            if not c["calibrated"]:
                lines.append(f"| {action} | {c['alpha']:.0%} | nothing certified | 0% | 0 | n/a | n/a |")
                continue
            lines.append(
                f"| {action} | {c['alpha']:.0%} | acts on {c['calibration_coverage']:.1%} | "
                f"{_fmt(c['test_coverage'], True)} | {c['test_acted']:,} | "
                f"{_fmt(c['test_error'], True)} | {verdict(c)} |"
            )
    alphas = result["alphas"]
    lines += ["", "| Action | Signal | AURC (lower is better) | " + " | ".join(f"Coverage at {a:.0%} error" for a in alphas) + " |"]
    lines.append("|---|---|---|" + "---|" * len(alphas))
    for action, a in result["actions"].items():
        for name, r in a["ranking"].items():
            cells = [_fmt(r["aurc"], False)] + [_fmt(r[f"coverage@{x:g}"], True) for x in alphas]
            lines.append(f"| {action} | {name} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("rows", type=Path)
    ap.add_argument("--out", type=Path, required=True, help="JSON results; a .md table is written beside it")
    ap.add_argument("--exclude-jira", action="append", default=[], help="drop a Jira from every split")
    ap.add_argument("--mature-days", type=float, default=0, help="drop test tickets this close to the dump")
    ap.add_argument("--holdout-projects", type=float, default=0, help="test only on this share of projects, unseen in fitting")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--delta", type=float, default=0.1)
    ap.add_argument("--n-boot", type=int, default=1000)
    ap.add_argument("--min-window", type=int, default=0, help="ask about tickets that searched fewer earlier issues (ADR 8)")
    args = ap.parse_args(argv)
    with args.rows.open() as f:
        rows = [json.loads(line) for line in f if line.strip()]
    last = max((r["created"] for r in rows), default=None) if args.mature_days else None
    rows = [r for r in rows if r["jira"] not in args.exclude_jira]
    rows = mature(rows, args.mature_days, last)
    held: set[str] = set()
    if args.holdout_projects:
        rows, held = hold_out_projects(rows, args.holdout_projects, args.seed)
    result = report(rows, delta=args.delta, n_boot=args.n_boot, min_window=args.min_window)
    result["excluded_jiras"] = args.exclude_jira
    result["mature_days"] = args.mature_days
    result["held_out_projects"] = sorted(held)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    md = to_markdown(result)
    args.out.with_suffix(".md").write_text(md)
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
