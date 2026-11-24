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
| 1c | Nov 18 | Clustered bound tightened (exact log-MGF per cluster size, exact binomial on single tickets). Calibrate certifies both actions into one policy file; the 3% clear policy is installed. Found: it cleared an exact copy in a two-issue window, so the app now asks about copies, and schema 2 adds window size, summary overlap and match age ([ADR 6](adr/0006-window-aware-gate-features.md)): clear at 3% covers 57.8% of test tickets with 1.4% error (without Mojang), and with Mojang the gate's AURC halves against the top score. Label-maturity cut (+0.2 points of error at 180 days) and project-held-out split (2.5%, 2.1%, 1.4% error over three draws). Both gates now ask on any non-finite feature. Moved on: the project's recent duplicate rate (needs link timestamps, or it leaks), copy check beyond the window (JQL summary search), hard-negative exclusion (week 2, with the mining code) | done |
| 1e | Nov 19 | Judge-facing app: the dial's budget table (2% to 5%) certified at the full delta, valid for every row at once ([ADR 7](adr/0007-one-delta-for-every-dial-budget.md)); budget-aware gate that closes on anything outside the table; budgets in Forge storage; capped decision log (admin only); shared triage for MCP and a UI resolver; UI Kit issue panel and admin page with a coverage chart; manifest checked by the Forge validator in CI; judge guide [TESTING.md](TESTING.md) (draft until deployed) | done |
| 1f | Nov 20 | Found by replaying the judge guide: a ten-issue project had its restated ticket cleared as new, since the gate extrapolates in tiny windows. Both gates now ask below a 30-issue window, certified with the rule on a fresh calibration draw that shares no ticket with the one the cut was chosen on ([ADR 8](adr/0008-ask-below-a-minimum-window.md)): clear at 3% covers 79.6% of test tickets with 1.8% error. Sample data for empty sites: 150 real Jira Software Server issues (CC BY 4.0) picked by a label-only rule, an admin-only resumable seeder, a progress section on the admin page, and a CI replay of the sample at each budget (3%: 119 cleared, 3 of 5 duplicates missed; 2.5%: 114 cleared) | done |
| 1g | Nov 21 | Hedge acts: an opt-in issue trigger (off on install) triages each new issue as the app and labels it hedge-cleared, hedge-duplicate or hedge-ask, skipping sample issues, subtasks, projects being seeded, repeated events and failed reads. No app-written duplicate links (the app can see issues the reporter cannot). The panel reports the call and claims it was applied only when the label is there. Right-or-wrong verdicts from the panel, one key per issue, counted against the budget only for calls the trigger carried out. Rovo agent over the same two actions. Redesigned panel (budget card, why, next step, linked candidates) and admin page (summary, save confirmations, readable log) | done |
| 1h | Nov 22 | Safer acting for real sites: the admin lists the projects Hedge acts in (empty means all; an unreadable list means none, never all), Jira 429 and 503 answers are retried with one shared 8 s budget per triage so Forge's time limit holds (creates retry only on 429), a project without a Labels field gets a named fix in the log instead of a bare 400, and the log shows why a call failed. Judge guide steps 2 to 5 checked on the deployed install | done |
| 1i | Nov 23 | Hedge stops itself: verdicts feed a test that stays valid when checked after every one ([ADR 9](adr/0009-pause-on-evidence-that-survives-repeated-checks.md)), and the action is paused everywhere until an admin resumes. A call marked wrong goes back to the queue, queued tickets are answered from the panel, the admin page counts the queue, closed gates say why, log entries have their own keys and expire. The demo page lets you trip the pause | done in code, not yet checked on the install |
| 1j | Nov 24 | The queue gets a page: each project has a Hedge queue that lists waiting tickets oldest first, compares each with its closest earlier issues (now shown with titles) and takes the answer. Naming the earlier issue writes the Duplicate link as the person, before the ticket leaves the queue, so a refused link drops nothing. The Rovo agent and MCP clients can list a project's queue | done in code, not yet checked on the install |
| 1d | next session | Deploy and walk steps 5.5 to 5.9 of TESTING.md on the dev site. Production deploy and the shared install link; install on a second clean site from that link; copy check beyond the window; per-project base-rate feature from link timestamps in the changelog (leak-free) | |
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
