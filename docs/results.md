# Results

## Installed policy (Nov 20, 2026)

The app ships the clear policy from [ADR 8](adr/0008-ask-below-a-minimum-window.md): it
asks about every ticket whose project has fewer than 30 earlier issues, and it was
certified on a fresh calibration draw (14,107 tickets without Mojang, 3.09% duplicates)
that shares no ticket with the sample the rule was chosen on. Train and test are the
Nov 18 rows unchanged.

```bash
cd ml
../.venv/bin/python -m hedge.rows ../data/corpus.pkl --out ../data/rows-fresh.jsonl --per-split 20000 --seed 1 --fresh-calibration ../data/rows.jsonl
../.venv/bin/python -m hedge.report ../data/rows-fresh.jsonl --out ../data/report3-no-mojang-mw30.json --exclude-jira Mojang --min-window 30
../.venv/bin/python -m hedge.calibrate ../data/rows-fresh.jsonl --retriever bm25-recent1000-v1 --alpha 0.03 --delta 0.1 --exclude-jira Mojang --budgets 0.02,0.025,0.03,0.035,0.05 --min-window 30 --out ../app/src/policy.js
../.venv/bin/python -m hedge.seed ../data/issues.jsonl.gz --jira Jira --project JSWSERVER --size 150 --min-duplicates 4 --out ../app/src/seed.js
```

| Action | Budget | Certified on calibration | Test coverage | Acted | Test error | Within budget |
|---|---|---|---|---|---|---|
| link | 1% to 10% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 1% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 3% | acts on 82.8% | 79.6% [74.4%, 83.8%] | 10,556 | 1.8% [1.3%, 2.3%] | yes |
| clear | 5% and 10% | acts on 99.4% | 99.2% [98.8%, 99.4%] | 13,156 | 2.2% [1.6%, 2.8%] | yes |

The admin dial's rows (calibration share cleared): 2% nothing certified, 2.5% 61.8%,
3% 82.8%, 3.5% 96.5%, 5% 99.4%.

### Against clearing every ticket

Duplicates are 2.1% [1.6%, 2.8%] of test tickets without Mojang, so a rule that clears
every ticket is wrong 2.1% of the time. An error rate under 3% is therefore not evidence of
skill by itself. What the gate adds is which tickets it leaves to a person:

| Budget | Tickets asked about | Test error | Duplicates kept for a person | Against asking at random |
|---|---:|---:|---:|---:|
| clear everything | 0% | 2.1% [1.6%, 2.8%] | 0% | n/a |
| 2.5% | 39.7% | 1.5% [1.1%, 2.0%] | 57.6% [48.2%, 65.0%] | 1.45x [1.24, 1.70] |
| 3% (default) | 20.4% | 1.8% [1.3%, 2.3%] | 32.5% [25.5%, 38.4%] | 1.59x [1.19, 2.04] |
| 3.5% | 5.6% | 2.0% [1.5%, 2.6%] | 9.5% [5.9%, 13.3%] | 1.69x [0.86, 3.12] |
| 5% | 0.8% | 2.2% [1.6%, 2.8%] | 0.0% | 0x |

So the gate beats asking at random at 2.5% and 3%, by a modest factor. At 3.5% the interval
includes 1, and at 5% the gate does no better than clearing everything. A site that cares
about caught duplicates should pick 2.5%. The certificate is still what tells an admin that
the rate holds; on a site with many more duplicates (Mojang: 15%) it certifies nothing at 3%.

```bash
../.venv/bin/python -m hedge.report ../data/rows-fresh.jsonl --out ../data/report4-dial.json --exclude-jira Mojang --min-window 30 --alphas 0.02,0.025,0.03,0.035,0.05
```

The same fresh draw with no minimum window certifies 83.4% and covers 80.4% [75.1%, 84.6%]
of test tickets with 1.8% error. The old draw certified 59.9% for that rule-free policy:
gate scores bunch between 0.95 and 0.97, so coverage swings with the draw while the error
stays put. The sections below are all on the old draw; compare their error rates, not
their coverage.

### Sample data (150 Jira Software Server issues, `app/test/seed.test.js`)

The latest 150 consecutive JSWSERVER issues with at least four in-span duplicates
(JSWSERVER-20774 to 20937, Nov 2020 to May 2021), created in order on an empty project
and replayed through the app's triage:

| Budget | Cleared | Asked | Duplicates cleared by mistake (of 5) |
|---|---:|---:|---:|
| 2% | 0 | 150 | 0 |
| 2.5% | 114 | 36 | 3 |
| 3% (default) | 119 | 31 | 3 |
| 3.5% | 120 | 30 | 3 |

The first 30 are always asked about (minimum window). The two duplicates Hedge asks about
fall inside those 30, so on this sample the gate itself caught none of the five. Each
missed one has its right original as the top candidate, which the panel shows.

## Nov 18 runs

Every number below comes from runs on Nov 18, 2026 (feature schema 2), reproducible with:

```bash
cd ml
../.venv/bin/python -c "from hedge.corpus import Corpus; Corpus.from_jsonl('../data/issues.jsonl.gz').save('../data/corpus.pkl')"
../.venv/bin/python -m hedge.rows ../data/corpus.pkl --out ../data/rows.jsonl --per-split 20000
../.venv/bin/python -m hedge.report ../data/rows.jsonl --out ../data/report.json
../.venv/bin/python -m hedge.report ../data/rows.jsonl --out ../data/report-no-mojang.json --exclude-jira Mojang
../.venv/bin/python -m hedge.report ../data/rows.jsonl --out ../data/mature180.json --exclude-jira Mojang --mature-days 180
../.venv/bin/python -m hedge.report ../data/rows.jsonl --out ../data/holdout-s0.json --exclude-jira Mojang --holdout-projects 0.25 --seed 0
../.venv/bin/python -m hedge.calibrate ../data/rows.jsonl --retriever bm25-recent1000-v1 --alpha 0.03 --exclude-jira Mojang --out ../app/src/policy.js
```

The corpus build takes 148 s and 4.2 GB of memory. The rows take 131 s: 37 s to tokenize
2,685,933 issues, then 60,000 windowed BM25 queries.

## Setup

- **Retriever** `bm25-recent1000-v1`: BM25 over the 1,000 most recent earlier issues of the
  ticket's project, the corpus the Forge app can read ([ADR 4](adr/0004-calibrate-on-the-scores-the-app-computes.md)).
- **Splits** by creation time: train before 2018-11-06, calibration until 2020-06-25, test
  from 2020-06-25 to the dump (2022-01-05). 20,000 tickets are sampled from each. Tickets
  whose text copies any earlier issue are left out (25,371, 8,930 and 12,327 of the full parts).
- **Actions**, each with its own gate and threshold: **link** the ticket to its top
  candidate, or **clear** it as a new report so nobody checks it for duplicates.
- **Certification**: Learn then Test, Bonferroni over 200 train-quantile thresholds,
  delta 0.1, errors counted per duplicate cluster with a bound that holds under any
  dependence inside a cluster ([ADR 5](adr/0005-per-ticket-risk-under-clustering.md)).
- **Gate features** (schema 2, [ADR 6](adr/0006-window-aware-gate-features.md)): top
  score, margin, entropy, summary length, has description, window size, summary overlap
  with the top candidate, and the top candidate's age.
- **Intervals**: 95%, resampling whole projects (1,000 draws).

## Retrieval baseline (test split)

| Measure | All Jiras | Without Mojang |
|---|---:|---:|
| Tickets with an earlier duplicate | 15.4% | 2.1% |
| Of those, an answer inside the window (recall ceiling) | 38.4% | 72.1% |
| Recall@1 | 18.1% | 33.9% |
| Recall@10 | 27.9% | 51.2% |
| MRR | 0.214 | 0.391 |
| Linking the top candidate is right | 2.8% | 0.7% |

Mojang files so many issues that 1,000 of them cover only days, so most of its duplicates
fall outside the window.

## Certified thresholds, checked on the test window

"Within budget" needs the whole 95% interval under the budget.

All Jiras:

| Action | Budget | Certified on calibration | Test coverage | Acted | Test error | Within budget |
|---|---|---|---|---|---|---|
| link | 1% to 10% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 1% and 3% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 5% | acts on 50.6% | 44.9% [31.6%, 65.1%] | 8,972 | 4.5% [2.7%, 6.5%] | unclear |
| clear | 10% | acts on 71.2% | 65.3% [51.6%, 83.7%] | 13,056 | 8.4% [3.3%, 13.7%] | unclear |

Without Mojang:

| Action | Budget | Certified on calibration | Test coverage | Acted | Test error | Within budget |
|---|---|---|---|---|---|---|
| link | 1% to 10% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 1% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 3% | acts on 59.9% | 57.8% [52.4%, 63.6%] | 7,671 | 1.4% [1.0%, 1.8%] | yes |
| clear | 5% and 10% | acts on 100% | 100% | 13,263 | 2.1% [1.6%, 2.8%] | yes |

At 5% and above without Mojang, the duplicate rate (2.1%) is already under the budget, so
clearing every ticket is certified. The gate earns its keep at 3%. The 3% clear policy is
the one installed in the app (`app/src/policy.js`).

## Ranking: the gate against the raw top score (clear action, test split)

| Data | Hedge gate AURC | BM25 top score AURC | Gate coverage at 3% error | Top score coverage at 3% error |
|---|---|---|---|---|
| All Jiras | 0.066 [0.023, 0.124] | 0.133 [0.026, 0.218] | 33.7% [20.2%, 65.1%] | 8.2% [3.7%, 49.2%] |
| Without Mojang | 0.012 [0.009, 0.016] | 0.012 [0.008, 0.018] | 100% | 100% |

With schema 1 the gate's AURC on all Jiras was 0.132, the same as the top score.

## Do late labels matter? (without Mojang, 3% clear policy)

Labels are Duplicate links as of the dump, so the newest test tickets have had less time
to be linked. Dropping them shows the size of the effect:

| Test tickets kept | Tickets | Duplicate rate | Test coverage | Test error |
|---|---:|---:|---|---|
| All | 13,263 | 2.1% | 57.8% [52.4%, 63.6%] | 1.4% [1.0%, 1.8%] |
| Filed 90+ days before the dump | 11,279 | 2.3% | 57.7% [52.5%, 63.2%] | 1.5% [1.1%, 2.0%] |
| Filed 180+ days before the dump | 9,053 | 2.4% | 58.4% [53.4%, 64.2%] | 1.6% [1.1%, 2.1%] |

The error rises by about 0.2 points on settled labels and stays within the 3% budget.

## Projects the gate never saw (without Mojang, 3% clear policy)

A quarter of the projects with test tickets (130) are held out of fitting and calibration,
along with any duplicate cluster that reaches them, and the test window is cut to them.
Three random draws:

| Draw | Test tickets | Duplicate rate | Calibration coverage | Test coverage | Test error | Within budget |
|---|---:|---:|---|---|---|---|
| 0 | 3,362 | 2.9% | 74.5% | 72.8% [68.9%, 77.9%] | 2.5% [1.8%, 3.2%] | unclear |
| 1 | 3,365 | 2.6% | 76.2% | 74.6% [72.1%, 78.3%] | 2.1% [1.2%, 2.9%] | yes |
| 2 | 3,680 | 2.2% | 43.7% | 37.7% [31.8%, 45.6%] | 1.4% [0.7%, 2.2%] | yes |

The point error stays under 3% in every draw, but in draw 0 the interval reaches 3.2%.
When the held-out projects' duplicate rate sits close to the budget, there is little room,
and how much the gate acts on swings with which projects are held out (38% to 75%).

## What this says

1. **Auto-linking duplicates is not safe with BM25 signals.** No budget up to 10% could be
   certified, on any data. Week 2's fine-tuned retriever has to change this, or the app
   should only offer links to a person.
2. **Clearing new tickets is where the value is.** Outside Mojang, Hedge can take 58% of
   new tickets off the duplicate-review queue while missing 1.4% of duplicates, under a
   certified 3% budget.
3. **Context features beat the raw score where windows differ.** With Mojang, the gate's
   ranking error is half the top score's. Without Mojang the ranking is no better, but the
   certified coverage at 3% rose from 37% to 58%.
4. **New projects are the open risk.** On held-out projects the budget held at the point
   estimate in all three draws, and its interval crossed 3% in one.

## Known biases

- **Label censoring.** Labels are Duplicate links as of the dump. Measured above: settled
  labels raise the clear error by about 0.2 points.
- **Copies.** The app asks about copies of issues in its window, but cannot see copies
  of older issues, which calibration also excluded.
- **Copies are left out.** Tickets that paste an earlier issue's text are excluded from
  calibration and test, so the numbers describe genuinely new reports.
- **Independence between clusters.** The bound allows any dependence inside a duplicate
  cluster, but treats different clusters as independent, although tickets in one project
  share a window and a time period.
