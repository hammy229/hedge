# Plan

Deadline: Codegeist 2026 submission, Tue Dec 22 2026, 12:00 pm PST. Target: submitted Mon Dec 21.
Category: Apps for Software Teams. Bonus: Best app with Atlassian MCP (`rovo:mcp`).

## The claim to test

At a fixed error budget, a trained and calibrated gate lets a triage agent act on more tickets
than the agent's own stated confidence, without going over the budget. Stated as one sentence
for the README: "At a 3% error budget, Hedge acts on X% of tickets [95% CI]; Claude's stated
confidence acts on Y% at the same realized error, or goes over the budget." If the claim is
false, the README says so.

## Data

Montgomery, Lüders and Maalej, "An Alternative Issue Tracking Dataset of Public Jira
Repositories", MSR 2022 ([arXiv 2201.08368](https://arxiv.org/abs/2201.08368),
[Zenodo 5901804](https://zenodo.org/records/5901804)). 16 public Jiras, 2.7M issues, about 1M
typed issue links. Labels: Duplicate links for retrieval, component for routing. The dump is
MongoDB and is not committed (see .gitignore).

## Status

| Week | Dates | Work | Status |
|---|---|---|---|
| 0 | Nov 15 | Repo, CI, threshold math (CRC + Learn then Test) with Monte Carlo guarantee tests, metrics, leakage tools, fail-closed gate, `rovo:mcp` tools | done |
| 0b | Nov 15 | Duplicate clusters and time-ordered labels, BM25 baseline, splits, gate features, gate model with Python to JS parity test, calibrate command, evaluation report, mongodump archive reader. Review fixes: per-cluster certification (ADR 2), strict calibration input checks, fast conformal thresholds, grid validation | done |
| 1a | Nov 16 | Review items: cluster-disjoint splits (train gives up rows; test keeps them, with an overlap mask); copy filter on calibration and test; policy bound to retriever id and feature schema, gate.js validates the whole policy; BM25 excludes the query, enforces time order, breaks ties by index, drops zero-score hits, builds from typed arrays; bootstrap grouping by sort; entropy over a fixed log(k); issue-key regex with project keys and a standards stoplist; shared Python and JS feature fixture (13 cases). Real data extracted: issues keyed by Jira and key, dates outside 2000 to 2022 treated as unknown, huge clusters labeled by direct links (ADR 3). Counts in [data.md](data.md) | done |
| 1b | Nov 17 | Corpus loader (2.7M issues, 148 s, 4.2 GB); retriever redefined as BM25 over the project's latest 1,000 earlier issues so offline scores equal the app's (ADR 4), ported to Forge with a shared fixture; copy filter over the full earlier corpus; temporal splits and gate rows; train-quantile threshold grid; separate link and clear gates; test-window report. Found and fixed: one ticket per cluster certified the wrong quantity (ADR 5), train selection used calibration labels, exact BM25 ties broke in JS. Results in [results.md](results.md): clear at 3% covers 36.9% of test tickets with 1.2% error (without Mojang); link certifies nothing | done |
| 1c | next session | Install the certified clear policy in app/src/policy.js (and make calibrate write both actions); features that beat the raw top score (window size, the project's recent duplicate rate, summary overlap with the top match), schema 2; tighter bound that is exact on single tickets; label-maturity check (drop the last months before the dump, report the change); project-held-out split; exclude same-big-cluster issues from hard-negative mining before week 2 | |
| 1 | Nov 16 to 22 | `forge login`, register, deploy, install on the dev site and on a second clean site. Spike: can onnxruntime-web run int8 bge-small inside a Forge function (bundle size, memory, cold start)? If no, use static embeddings distilled from the fine-tuned encoder and report the accuracy cost. Download the dataset, build temporal, project-held-out and calibration splits, run leakage checks, BM25 and off-the-shelf embedding baselines | |
| 2 | Nov 23 to 29 | Training on TACC: contrastive fine-tune of bge-small on Duplicate pairs with BM25 hard negatives, component router head. Ablations: hard negatives on and off, distillation gap, cross-project transfer | |
| 3 | Nov 30 to Dec 6 | Gate features (top-1 score, margin, router entropy, text length, retriever and LLM agreement), gate model, calibration, risk-coverage curves and AURC. LLM baselines through Forge LLM on 1,000 to 2,000 test tickets (stated confidence; agreement over 5 samples on a subset; estimate cost first). Export models, wire the issue trigger | |
| 4 | Dec 7 to 13 (finals) | Admin page with the error-budget dial and live curve. Issue panel showing act or ask and why. Sample-project seeder so judges' empty sites have tickets | |
| 5 | Dec 14 to 20 | Online threshold updates from human overrides (adaptive conformal). README results, video under 5 minutes, full install on a fresh site from the install link | |
| 6 | Dec 21 to 22 | Submit. Then the write-up post | |

## Cut line

Drop in this order if behind: Marketplace listing, online threshold updates, ambiguity reasons,
cross-encoder reranker, Rovo agent surface, component routing.

Never cut: the held-out evaluation with confidence intervals, the LLM confidence baseline, the
error-budget dial, and a working install on a clean site.

## Rules from the Codegeist terms that shape the build

- Judges install from an install link into their own site, so the app must work on an empty site.
- The video is under 5 minutes, public on YouTube, no copyrighted music.
- Submission needs testing instructions for every configuration step, including turning on
  external MCP access in Atlassian Administration.
