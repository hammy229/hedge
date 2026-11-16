# Hedge

**A Jira triage agent that only acts when it can prove it stays inside the error rate you set, and asks a person about everything else.**

[![CI](https://github.com/hammy229/hedge/actions/workflows/ci.yml/badge.svg)](https://github.com/hammy229/hedge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Links:** [Plan](docs/PLAN.md) · [Data](docs/data.md) · [Design decisions](docs/adr/) · [arhamdoshi.dev](https://arhamdoshi.dev) · [linkedin.com/in/arhamdoshi](https://linkedin.com/in/arhamdoshi)

> Status: in progress for Atlassian Codegeist 2026 (due Dec 22, 2026). The threshold math, its
> tests and the Forge tool surface are done. The trained models are not, so the app currently
> asks a person about every ticket, by design. See [docs/PLAN.md](docs/PLAN.md).

## Results

Only numbers this repo produces. The real-data rows fill in as the plan's weeks land.

| Claim | Measured | How it is checked |
|---|---|---|
| The selective risk guarantee holds | 0 of 400 calibration draws certified a threshold with true error above 10% (allowed: 10% of draws) | `ml/tests/test_risk.py`, synthetic tickets with a known error curve |
| It still acts on a useful share | 28.6% of tickets certified at a 10% budget, where the best possible is 40% | same test file, 5,000 synthetic tickets |
| Conformal risk control is tight | mean marginal risk 0.0495 against a 0.05 target over 400 draws | same test file |
| Correlated tickets break the naive test, and per-cluster testing fixes it | false certification 24.8% (clusters of 10) and 38.3% (clusters of 20) against 10% allowed; 0.0% for both after testing one ticket per cluster | same test file, [ADR 2](docs/adr/0002-certify-one-ticket-per-cluster.md) |
| The Forge gate scores exactly like the Python model | 50 of 50 tickets match to 1e-12 | `ml/tests/test_gate.py` runs `app/src/gate.js` under Node |
| The Forge app computes the same features as training | 13 of 13 shared cases agree to 1e-12, including Unicode whitespace edge cases | `fixtures/features.json`, read by both test suites |
| The real dataset streams without a database | 2,686,223 issues and 271,185 Duplicate pairs in 261 s from the 5.8 GB zip | `python -m hedge.extract`, counts in [docs/data.md](docs/data.md) |
| Hedge beats the agent's own confidence on real Jira tickets | not measured yet | week 3: held-out Apache, MongoDB and Red Hat Jira data, 95% cluster bootstrap CIs |

## Why it matters

Teams switch off AI triage after one confident wrong action, like a real bug closed as a
duplicate, because that one mistake costs more than the time the bot saved. Today's agents
decide when to act using their own stated confidence, and nobody publishes how often that
confidence is wrong.

Hedge turns that into a setting. An admin picks an error budget, say 3%. Hedge acts only on
tickets where a calibrated statistical test shows the error rate among its actions stays under
3%, and hands every other ticket to a person with the reason.

## How it works

1. A fine-tuned embedding model finds likely duplicates and a router suggests the owning team.
2. A small gate model turns signals such as the top match score, the gap to the second match
   and the router's uncertainty into a probability that acting would be right.
3. On a held-out calibration set, Learn then Test picks the lowest threshold whose error among
   acted tickets is certified under the budget (alpha) with probability 1 - delta.
4. Inside Forge, the gate compares each ticket's score to that threshold. Below it, or with any
   missing signal, the ticket goes to a person.
5. The same gate is exposed through `rovo:mcp`, so external agents such as Claude Desktop go
   through it too.

| Choice | Why |
|---|---|
| Certify selective risk P(wrong given act), not overall error | "At most 3% of what the bot does is wrong" is the promise an admin actually wants |
| Bonferroni over a fixed grid, not fixed sequence testing | Fixed sequence certified nothing in testing, see [ADR 1](docs/adr/0001-bonferroni-over-fixed-sequence.md) |
| Certify on one ticket per duplicate cluster | Bursts of duplicates succeed or fail together, and counting them as separate trials broke the guarantee, see [ADR 2](docs/adr/0002-certify-one-ticket-per-cluster.md) |
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
│   ├── src/features.js     Jira issue to gate features (ADF text extraction)
│   ├── src/policy.js       calibrated policy, written by ml/ (placeholder until trained)
│   ├── src/index.js        tool handlers: triage-issue, explain-policy
│   └── test/               node:test suite
├── fixtures/features.json  feature cases shared by the Python and JavaScript tests
├── ml/                     training and calibration
│   ├── hedge/archive.py    streams issues out of the mongodump archive
│   ├── hedge/extract.py    one pass from the zip to slim issue records and dataset counts
│   ├── hedge/dupes.py      duplicate clusters and time-ordered labels
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
    └── adr/                design decision records
```

## Testing

```bash
cd ml && ../.venv/bin/pytest -q     # 151 tests, including a Python to JavaScript parity check
cd app && npm test                  # 26 tests
```

CI runs both suites on every push and pull request to main.

## Limitations and next steps

- No trained model yet. Until week 3 the gate has no calibrated policy and asks about every ticket.
- The guarantee assumes new tickets look like the calibration tickets. Ticket streams drift, so
  the evaluation will report realized error on a later time window, not just the bound.
- Bonferroni is conservative: on synthetic data it certified 28.6% coverage where 40% was possible.
- Public Apache-style Jira data is not a typical company's Jira. Cross-project results will show
  how far it transfers.
- `rovo:mcp` and external MCP access are in Preview and may change before the deadline.

## License

MIT, see [LICENSE](LICENSE). Built by [Arham Doshi](https://arhamdoshi.dev).
