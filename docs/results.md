# Results

Every number here comes from one run on Nov 17, 2026, reproducible with:

```bash
cd ml
../.venv/bin/python -c "from hedge.corpus import Corpus; Corpus.from_jsonl('../data/issues.jsonl.gz').save('../data/corpus.pkl')"
../.venv/bin/python -m hedge.rows ../data/corpus.pkl --out ../data/rows.jsonl --per-split 20000
../.venv/bin/python -m hedge.report ../data/rows.jsonl --out ../data/report.json
../.venv/bin/python -m hedge.report ../data/rows.jsonl --out ../data/report-no-mojang.json --exclude-jira Mojang
```

The corpus build takes 148 s and 4.2 GB of memory. The rows take 122 s: 33 s to tokenize
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
| clear | 1% to 5% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 10% | acts on 9.4% | 8.5% [6.7%, 11.0%] | 1,699 | 6.8% [1.5%, 13.3%] | unclear |

Without Mojang:

| Action | Budget | Certified on calibration | Test coverage | Acted | Test error | Within budget |
|---|---|---|---|---|---|---|
| link | 1% to 10% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 1% | nothing certified | 0% | 0 | n/a | n/a |
| clear | 3% | acts on 38.6% | 36.9% [31.8%, 43.0%] | 4,891 | 1.2% [0.7%, 1.9%] | yes |
| clear | 5% and 10% | acts on 100% | 100% | 13,265 | 2.1% [1.6%, 2.8%] | yes |

At 5% and above without Mojang, the duplicate rate (2.1%) is already under the budget, so
clearing every ticket is certified. The gate earns its keep at 3%.

## What this says

1. **Auto-linking duplicates is not safe with BM25 signals.** No budget up to 10% could be
   certified, on any data. Linking is right for under 3% of tickets, and the gate cannot
   find a subset where it is right 97% of the time. Week 2's fine-tuned retriever has to
   change this, or the app should only offer links to a person.
2. **Clearing new tickets is where the value is.** Outside Mojang, Hedge can take 37% of
   new tickets off the duplicate-review queue while missing 1.2% of duplicates, under a
   certified 3% budget.
3. **The gate does not beat the raw top score yet.** On the clear action both have AURC
   0.012 without Mojang. The text features add nothing beyond the top BM25 score so far.
4. **Mojang is a different problem.** 15% of its tickets are duplicates, mostly of hub
   tickets outside any 1,000-issue window.

## Known biases

- **Label censoring.** Labels are Duplicate links as of the dump, and the newest tickets
  have had less time to be linked. Without Mojang the duplicate rate falls from 2.5% in
  the first half of the test window to 1.7% in the second, so the test error of the clear
  action is probably understated a little.
- **Copies are left out.** Tickets that paste an earlier issue's text are excluded from
  calibration and test, so the numbers describe genuinely new reports.
- **Independence between clusters.** The bound allows any dependence inside a duplicate
  cluster, but treats different clusters as independent, although tickets in one project
  share a window and a time period.
