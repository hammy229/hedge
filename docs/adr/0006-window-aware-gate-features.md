# 6. Give the gate the window size, the summary overlap and the match age (schema 2)

Date: 2026-11-18. Status: accepted.

## Context

The schema 1 gate saw five numbers: the top BM25 score, the margin to the second, the
entropy of the top 10, the summary length and whether a description exists. On the real
test window its ranking was no better than the raw top score (clear AURC 0.012 against
0.012 without Mojang, 0.132 against 0.133 with it).

Installing the certified clear policy in the app exposed why. A BM25 score depends on its
corpus. In a window of two issues every term is in half the documents, so IDF is small and
even an exact copy scores low. The gate had only seen windows of up to 1,000 issues, read
the low score as "nothing similar", and cleared the copy. Small windows are common: every
new project starts with one.

## Decision

Feature schema 2 adds three features, computed the same way in `hedge.features` and
`app/src/features.js` and checked against shared cases in `fixtures/features.json`:

| Feature | Definition | Why |
|---|---|---|
| `logWindow` | log(1 + issues searched) | puts the score on the window's scale |
| `summaryOverlap` | Jaccard overlap of the BM25 token sets of the two summaries | duplicates restate the title |
| `logTopAgeDays` | log(1 + days from the top candidate to the ticket) | duplicates of a fresh bug arrive within days |

All three use only what exists when the ticket is filed: the ticket, and the earlier
issues in its window. No label or link is read.

Separately, the app now refuses to act on a ticket whose normalized text copies an issue
in its window, because calibration left copies out (`hedge.corpus.earlier_copies`) and
the guarantee says nothing about them.

## Results

Same 60,000 sampled tickets, same splits, Learn then Test at delta 0.1:

| | Schema 1 | Schema 2 |
|---|---|---|
| Clear AURC, all Jiras (top score: 0.133) | 0.132 | 0.066 [0.023, 0.124] |
| Clear AURC, without Mojang (top score: 0.012) | 0.012 | 0.012 [0.009, 0.016] |
| Clear at 3% without Mojang: calibration coverage | 38.6% | 59.9% |
| Same, test coverage | 36.9% [31.8, 43.0] | 57.8% [52.4, 63.6] |
| Same, test error | 1.2% [0.7, 1.9] | 1.4% [1.0, 1.8] |
| Clear at 5%, all Jiras | nothing certified | 44.9% coverage, 4.5% [2.7, 6.5] error |

The tighter clustered bound added in the same session (exact binomial on single tickets,
no 1 - x <= exp(-x) step) certified the same 38.6% on the schema 1 rows, so the coverage
gain comes from the features.

## Consequences

- Policies carry `featureSchema: 2`. The app refuses a schema 1 policy, so the shipped
  policy was regenerated in the same change.
- Without Mojang the ranking did not improve (AURC is flat). The certified coverage did,
  because the probabilities near the threshold are better spread. With Mojang, where window
  size and match age vary the most, the ranking error halved.
- The app checks copies only inside the 1,000-issue window. A ticket pasted from an older
  issue is not caught, although calibration excluded it. A JQL search for the exact
  summary would close the gap.
