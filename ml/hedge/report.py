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


def gate_scores(policy: dict, rows: Sequence[dict]) -> np.ndarray:
    m = policy["model"]
    w = np.array([m["weights"][n] for n in FEATURE_NAMES])
    return expit(to_matrix(rows) @ w + m["bias"])


def baseline_scores(action: str, rows: Sequence[dict]) -> np.ndarray:
    """Raw BM25 top score: link when it is high, clear when it is low."""
    top1 = np.array([r["top1"] for r in rows], dtype=float)
    return top1 if action == "link" else -top1


def report(rows: list[dict], alphas=ALPHAS, delta: float = 0.1, n_boot: int = 1000, seed: int = 0) -> dict:
    fit_rows = [r for r in rows if r["split"] != "test"]
    test = [r for r in rows if r["split"] == "test"]
    if not test:
        raise ValueError("no test rows")
    projects = [r["project"] for r in test]
    out: dict = {
        "n_test": len(test),
        "test_projects": len(set(projects)),
        "delta": delta,
        "alphas": list(alphas),
        "actions": {},
    }
    for action in ACTIONS:
        wrong = np.array([1 - r["right"] for r in for_action(test, action)], dtype=float)
        certified = []
        probs = None
        for alpha in alphas:
            policy = build_policy(fit_rows, alpha, delta, RETRIEVER, action=action)
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
                act = probs >= t

                def risk(i, act=act):
                    a = act[i]
                    return float(wrong[i][a].mean()) if a.any() else 0.0

                boot = dict(clusters=projects, n_boot=n_boot, seed=seed)
                row["test_coverage"] = cluster_bootstrap_ci(lambda i, act=act: float(act[i].mean()), **boot)
                row["test_error"] = cluster_bootstrap_ci(risk, **boot)
                row["test_acted"] = int(act.sum())
            certified.append(row)
        ranking = {
            "Hedge gate": evaluate_method(probs, wrong, projects, alphas, n_boot=n_boot, seed=seed),
            "BM25 top score": evaluate_method(baseline_scores(action, test), wrong, projects, alphas, n_boot=n_boot, seed=seed),
        }
        out["actions"][action] = {"base_error": float(wrong.mean()), "certified": certified, "ranking": ranking}
    return out


def to_markdown(result: dict) -> str:
    lines = [
        "| Action | Budget | Certified on calibration | Test coverage | Test error | Within budget |",
        "|---|---|---|---|---|---|",
    ]
    for action, a in result["actions"].items():
        for c in a["certified"]:
            if not c["calibrated"]:
                lines.append(f"| {action} | {c['alpha']:.0%} | nothing certified | 0% | n/a | n/a |")
                continue
            ok = "yes" if c["test_error"][0] <= c["alpha"] else "no"
            lines.append(
                f"| {action} | {c['alpha']:.0%} | acts on {c['calibration_coverage']:.1%} | "
                f"{_fmt(c['test_coverage'], True)} | {_fmt(c['test_error'], True)} | {ok} |"
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
    ap.add_argument("--delta", type=float, default=0.1)
    ap.add_argument("--n-boot", type=int, default=1000)
    args = ap.parse_args(argv)
    with args.rows.open() as f:
        rows = [r for line in f if line.strip() and (r := json.loads(line))["jira"] not in args.exclude_jira]
    result = report(rows, delta=args.delta, n_boot=args.n_boot)
    result["excluded_jiras"] = args.exclude_jira
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    md = to_markdown(result)
    args.out.with_suffix(".md").write_text(md)
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
