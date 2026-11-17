# 4. Calibrate on the scores the app can compute

Date: 2026-11-17. Status: accepted.

## Context

The gate reads retrieval scores (top score, margin, entropy), and the threshold is
certified on those scores. The plan was to compute them offline with one BM25 index per
Jira, the biggest being Apache with 1,014,909 issues.

A BM25 score is not a property of two texts. It depends on the corpus: IDF counts how many
documents hold each term, and length normalization divides by the corpus's average
length. The same pair of tickets scores differently in a 1M-issue index than in a
500-issue one. The Forge app runs in a function with a time limit and no dataset. It can
read the installing site's issues through the Jira REST API, and nothing more.

So a threshold certified on dataset-wide scores would be certified for numbers the app
never computes. The guarantee ("at most 3% wrong among acted tickets") would hold for a
retriever that is not deployed.

## Decision

The retriever is defined by what the app can compute, and calibration uses exactly that:

- For a ticket created at time t, the corpus is the 1,000 most recent issues of the same
  project created strictly before t.
- BM25 (k1 1.2, b 0.75, Lucene's IDF) is indexed on that window alone.
- Ties in score go to the older issue.

Its id is `bm25-recent1000-v1`. `ml/hedge/window.py` computes it offline, `app/src/bm25.js`
computes it in Forge, and a shared fixture keeps them equal. The policy records the id,
and the gate refuses to act when the app's id differs.

## Consequences

- Duplicates filed in another project, or more than 1,000 issues back, cannot be found.
  The evaluation reports how many correct answers fall inside the window, so this recall
  ceiling is measured instead of hidden.
- A judge's site with a seeded sample project behaves like a small project in the data,
  and window size varies by project. The gate sees the same kind of variation in
  calibration as in deployment.
- Offline evaluation is cheaper: each query touches at most 1,000 documents.
- A learned retriever (week 2) will need the same treatment: scores are certified only
  for the corpus definition they were computed on.
