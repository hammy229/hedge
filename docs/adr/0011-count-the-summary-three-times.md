# ADR 11: Count the summary three times in the retriever

Date: Nov 26, 2026. Status: accepted.

## Problem

The retriever scored a ticket's summary and description as one bag of words. A description is
up to 1,000 characters and a summary is one line, so long shared text (stack traces, version
strings, template headings) outvoted a restated title. Duplicates are mostly restated titles.
The gate can only be as good as its top candidate, and "a better retriever is the next lever"
was the open item in the README.

## Decision

Write the summary three times before the description, in both the documents and the query.
That multiplies its term counts and its share of the length normalization, which is how BM25
weights a field without a second index. The retriever is now `bm25-recent1000-title3-v2`, and
the policy is bound to that id, so a v1 policy cannot run with v2 scores (the gate fails closed).

- The weight was picked on training duplicates only (`python -m hedge.sweep`, 3,636 tickets
  without Mojang and 2,864 with it, every one with its duplicate inside the window). Calibration
  and test tickets played no part, so the policy certified on them stays valid.
- Retrieval hit@1 on those training tickets, by weight:

  | Weight | Without Mojang | Mojang |
  |---:|---:|---:|
  | 1 (v1) | 41.3% | 48.9% |
  | 2 | 44.5% | 50.5% |
  | 3 | 45.0% | 51.0% |
  | 4 | 45.0% | 50.6% |
  | 5 | 44.6% | 50.1% |

  BM25's k1 (0.9, 1.5) and b (0.5, 0.9) moved hit@1 by less than a point on an earlier
  3,000-ticket check, so they stay at 1.2 and 0.75.
- The JavaScript retriever repeats the summary the same way, and `fixtures/bm25.json` gained a
  case where a restated title must beat a shared stack trace.

## Result

Rows were rebuilt on the same tickets as before (seed 0, then a fresh calibration draw with
seed 1) and the policy recalibrated with the same command. On test tickets without Mojang:

- Retrieval: recall@1 33.9% to 37.5%, recall@10 51.2% to 54.4%, MRR 0.391 to 0.428 (283
  test tickets with a duplicate, so the intervals are wide).
- The 2% budget now certifies: it clears 41.5% [36.7, 46.9] of test tickets with 1.2% error.
  Before, it certified nothing. At 2.5% coverage rises from 60.3% to 63.2%; 3% is unchanged
  (79.5% against 79.6%, error 1.8%).
- On the 150-issue sample, 2% clears 105 and asks about DEMO-37, the first duplicate the gate
  itself catches there (the other two caught ones fall inside the first 30 issues).

## Limits

- The gain is modest. Most missed duplicates share few words with their original, which no
  word weighting fixes. The trained encoder in week 2 is still the larger lever.
- Three is a training-set choice among five values. It is not tuned per project.
