# Hedge

**A Jira triage agent that only acts when it can prove it stays inside the error rate you set, and asks a person about everything else.**

[![CI](https://github.com/hammy229/hedge/actions/workflows/ci.yml/badge.svg)](https://github.com/hammy229/hedge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Links:** [Plan](docs/PLAN.md) · [Results](docs/results.md) · [Data](docs/data.md) · [Design decisions](docs/adr/) · [arhamdoshi.dev](https://arhamdoshi.dev) · [linkedin.com/in/arhamdoshi](https://linkedin.com/in/arhamdoshi)

> Status: in progress for Atlassian Codegeist 2026 (due Dec 22, 2026). The threshold math, the
> BM25 baseline on 2.7M real issues and the Forge retrieval path are done. The certified policy
> is not installed in the app yet, so it still asks a person about every ticket, by design.
> See [docs/PLAN.md](docs/PLAN.md).

## Results

Only numbers this repo produces. Real-data rows come from [docs/results.md](docs/results.md):
20,000 test tickets from the latest time window, 95% intervals that resample whole projects.

| Claim | Measured | How it is checked |
|---|---|---|
| Clearing new tickets from duplicate review is safe at a 3% budget | without Mojang, 36.9% [31.8, 43.0] of test tickets cleared with 1.2% [0.7, 1.9] of them duplicates; certified on calibration, checked on the later test window | `python -m hedge.report`, [results](docs/results.md) |
| Auto-linking duplicates with BM25 signals is not safe | no threshold certified at any budget up to 10%, with or without Mojang; linking the top candidate is right for 2.8% of test tickets | same report |
| One ticket per cluster certified the wrong quantity | on calibration, duplicates are 15.1% of tickets but 8.2% of clusters; the old test certified 5% and 10% budgets that the test window broke (6.9%, 15.4% error). The per-cluster bound falsely certifies 1.3% of synthetic draws where the old test did 83.7% | `tests/test_risk.py`, [ADR 5](docs/adr/0005-per-ticket-risk-under-clustering.md) |
| BM25 over the project's last 1,000 issues, the corpus the app can read | recall@1 33.9%, recall@10 51.2%, MRR 0.391 on test tickets with a duplicate (without Mojang); 72.1% of answers fall inside the window | `python -m hedge.rows`, [ADR 4](docs/adr/0004-calibrate-on-the-scores-the-app-computes.md) |
| The Forge retriever scores exactly like the Python one | 10 of 10 shared cases agree to 1e-9 on texts, scores, top candidates and features, including Unicode and emoji cuts | `fixtures/bm25.json`, read by both test suites |
| The selective risk guarantee holds | 0 of 400 calibration draws certified a threshold with true error above 10% (allowed: 10% of draws) | `ml/tests/test_risk.py`, synthetic tickets with a known error curve |
| It still acts on a useful share | 28.6% of tickets certified at a 10% budget, where the best possible is 40% | same test file, 5,000 synthetic tickets |
| Conformal risk control is tight | mean marginal risk 0.0495 against a 0.05 target over 400 draws | same test file |
| Correlated tickets break the naive test | false certification 24.8% (clusters of 10) and 38.3% (clusters of 20) against 10% allowed | same test file, [ADR 2](docs/adr/0002-certify-one-ticket-per-cluster.md) |
| The Forge gate scores exactly like the Python model | 50 of 50 tickets match to 1e-12 | `ml/tests/test_gate.py` runs `app/src/gate.js` under Node |
| The Forge app computes the same features as training | 13 of 13 shared cases agree to 1e-12, including Unicode whitespace edge cases | `fixtures/features.json`, read by both test suites |
| The real dataset streams without a database | 2,686,223 issues and 271,185 Duplicate pairs in 261 s from the 5.8 GB zip | `python -m hedge.extract`, counts in [docs/data.md](docs/data.md) |
| The gate beats the raw BM25 top score | not yet: both have AURC 0.012 on the clear action | same report |
| Hedge beats the agent's own stated confidence | not measured yet | week 3: LLM baseline on the same test tickets |

## Why it matters

Teams switch off AI triage after one confident wrong action, like a real bug closed as a
duplicate, because that one mistake costs more than the time the bot saved. Today's agents
decide when to act using their own stated confidence, and nobody publishes how often that
confidence is wrong.

Hedge turns that into a setting. An admin picks an error budget, say 3%. Hedge acts only on
tickets where a calibrated statistical test shows the error rate among its actions stays under
3%, and hands every other ticket to a person with the reason.

## How it works

1. For a new ticket, BM25 searches the 1,000 most recent earlier issues of its project, the
   same corpus offline and inside Forge (a fine-tuned embedding model replaces it in week 2).
2. Two small gate models turn signals such as the top match score, the gap to the second match
   and its entropy into the probability that each action is right: **link** the ticket to the
   top match, or **clear** it as a new report.
3. On a held-out calibration window, Learn then Test picks, per action, the lowest threshold
   whose error among acted tickets is certified under the budget (alpha) with probability
   1 - delta, counting errors per duplicate cluster.
4. A later test window checks that the certified error held under drift.
5. Inside Forge, each gate compares the ticket's score to its threshold. Below both, with
   both above, or with any missing signal or unreadable window, the ticket goes to a person.
6. The same gate is exposed through `rovo:mcp`, so external agents such as Claude Desktop go
   through it too.

| Choice | Why |
|---|---|
| Certify selective risk P(wrong given act), not overall error | "At most 3% of what the bot does is wrong" is the promise an admin actually wants |
| Bonferroni over a fixed grid, not fixed sequence testing | Fixed sequence certified nothing in testing, see [ADR 1](docs/adr/0001-bonferroni-over-fixed-sequence.md) |
| Count errors per duplicate cluster with a worst-case bound | Bursts of duplicates succeed or fail together ([ADR 2](docs/adr/0002-certify-one-ticket-per-cluster.md)), and testing one ticket per cluster measured the error over clusters instead of tickets ([ADR 5](docs/adr/0005-per-ticket-risk-under-clustering.md)) |
| Calibrate on the corpus the app can read | BM25 scores depend on their corpus, so a threshold certified on a dataset-wide index would not apply to the app's scores, see [ADR 4](docs/adr/0004-calibrate-on-the-scores-the-app-computes.md) |
| Separate gates for link and clear | Linking is right for under 3% of tickets and clearing for over 85%, so they need different evidence and different thresholds |
| Threshold grid at train score quantiles | The gate's probabilities bunch between 0.9 and 1.0, where an even grid has ten points; train data may shape the grid because only calibration must stay unseen |
| Read Jira through REST v2 | v2 returns descriptions as wiki-markup strings, the form the training data has |
| Key issues by Jira and key | 6,052 keys name unrelated issues in two Jiras, which merged their duplicate clusters |
| Label huge clusters by direct links only | Links between Mojang catch-all tickets chain into clusters of over 20,000 unrelated issues, see [ADR 3](docs/adr/0003-direct-links-in-huge-clusters.md) |
| Bind the policy to its retriever and feature schema | A threshold certified on one retriever's score scale means nothing on another's, so the gate asks on a mismatch |
| Read the mongodump archive directly | The dataset is one 5.8 GB archive that restores to about 60 GB; streaming it needs no MongoDB server and no spare disk |
| Fail closed | No policy, a malformed or mismatched policy, a missing feature or a bad score all mean "ask", never "act" |
| Small trained models, not a fine-tuned LLM | Forge's hosted LLMs cannot be fine-tuned, and small models run inside Forge without a server |
| Cluster bootstrap by project | Tickets in one project are correlated, so resampling tickets would give intervals that are too narrow |
| Strip issue keys and "duplicate of" text from inputs | Public Jira text often names the answer, which inflates duplicate-detection scores |

## Tech stack

Python (NumPy, SciPy, pytest) for training and calibration; JavaScript on Atlassian Forge (`@forge/api`, `rovo:mcp`) for the app; GitHub Actions CI.

## Getting started

Calibration library and tests:

```bash
cd ml
python3 -m venv ../.venv && ../.venv/bin/pip install -e '.[test]'
../.venv/bin/pytest -q
```

Forge app (needs Node 22 or 24 and an [Atlassian API token](https://id.atlassian.com/manage/api-tokens)):

```bash
npm install -g @forge/cli
forge login
forge site provision        # free 90-day dev site with Jira, Confluence and Rovo
cd app && npm install
forge register              # then put the printed app id in manifest.yml
forge deploy && forge install --demo-site
```

To reach the tools from an external MCP client, turn on "Expose tools via external MCP
endpoint" for the app under Atlassian Administration, Apps, Sites, Connected apps. Then add
`https://mcp.atlassian.com/forge/<appId>` to the client.

## Project structure

```
hedge/
├── app/                    Forge app
│   ├── manifest.yml        rovo:mcp module and its two tools
│   ├── src/gate.js         fail-closed act-or-ask decision
│   ├── src/features.js     gate features (shared definitions with ml/)
│   ├── src/text.js         answer-text stripping and the description cut, as in ml/
│   ├── src/bm25.js         the window retriever, bm25-recent1000-v1
│   ├── src/window.js       reads a project's latest 1,000 earlier issues from Jira search
│   ├── src/triage.js       link and clear gates for one ticket
│   ├── src/policy.js       calibrated policies per action, written by ml/ (placeholders now)
│   ├── src/index.js        tool handlers: triage-issue, explain-policy
│   └── test/               node:test suite
├── fixtures/features.json  feature cases shared by the Python and JavaScript tests
├── fixtures/bm25.json      retrieval cases shared by both, written by hedge.contract
├── ml/                     training and calibration
│   ├── hedge/archive.py    streams issues out of the mongodump archive
│   ├── hedge/extract.py    one pass from the zip to slim issue records and dataset counts
│   ├── hedge/dupes.py      duplicate clusters and time-ordered labels
│   ├── hedge/corpus.py     time-sorted corpus with row-index labels and a copy flag
│   ├── hedge/window.py     BM25 over the project's latest 1,000 earlier issues
│   ├── hedge/rows.py       temporal splits and sampled tickets to gate rows
│   ├── hedge/report.py     certify on calibration, check on the test window
│   ├── hedge/contract.py   writes fixtures/bm25.json
│   ├── hedge/bm25.py       BM25 baseline retriever (excludes the query and later issues)
│   ├── hedge/splits.py     temporal and project-held-out splits, cluster and copy filters
│   ├── hedge/features.py   gate features (names shared with the Forge app)
│   ├── hedge/gate.py       logistic gate model and policy export
│   ├── hedge/calibrate.py  fit, certify, write app/src/policy.js
│   ├── hedge/risk.py       conformal risk control and Learn then Test thresholds
│   ├── hedge/evaluate.py   compares confidence methods, renders the results table
│   ├── hedge/metrics.py    risk-coverage, AURC, recall@k, MRR, cluster bootstrap CIs
│   ├── hedge/leakage.py    answer-text stripping and cross-split copy detection
│   └── tests/              pytest suite, including Monte Carlo guarantee checks
└── docs/
    ├── PLAN.md             dated plan with status
    ├── data.md             dataset counts and quality notes
    ├── results.md          real-data results and how to reproduce them
    └── adr/                design decision records
```

## Testing

```bash
cd ml && ../.venv/bin/pytest -q     # 211 tests, including Python to JavaScript parity checks
cd app && npm test                  # 50 tests
```

CI runs both suites on every push and pull request to main.

## Limitations and next steps

- The certified policies are not installed in the app yet, so it asks about every ticket.
- Auto-linking is not certified at any budget with BM25. It needs a better retriever (week 2)
  or should stay a suggestion for a person.
- The gate's features do not beat the raw BM25 top score yet.
- Labels are Duplicate links as of the January 2022 dump, and recent tickets have had less
  time to be linked, so test error for the clear action is probably understated a little.
- The guarantee assumes calibration and new tickets are exchangeable, and treats duplicate
  clusters as independent. The test window checks the first under real drift.
- The bounds are conservative: Bonferroni over the grid, and a Chernoff bound that is a little
  looser than the exact binomial for single tickets.
- Mojang (15% duplicates, mostly of hubs outside any 1,000-issue window) is far harder than the
  other Jiras, so results are reported with and without it.
- Public Apache-style Jira data is not a typical company's Jira. Cross-project results will show
  how far it transfers.
- `rovo:mcp` and external MCP access are in Preview and may change before the deadline.

## License

MIT, see [LICENSE](LICENSE). Built by [Arham Doshi](https://arhamdoshi.dev).
