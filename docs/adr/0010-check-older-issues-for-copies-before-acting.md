# ADR 10: Check older issues for copies before acting

Date: Nov 25, 2026. Status: accepted.

## Problem

Calibration and test rows leave out every ticket whose normalized text appeared in any earlier
issue, over the whole corpus (`hedge.corpus.earlier_copies`). The certified thresholds say
nothing about such tickets. The app asked about copies only inside its retrieval window, the
latest 1,000 earlier issues of the project. A ticket pasted from an older issue, or from another
project, could be cleared as new, outside what was certified.

## Decision

When a gate would act, search Jira for earlier issues in every project the reader can see whose
summary holds the ticket's words, and compare normalized texts. A copy becomes an ask that names
the older issue. So does a search that failed, ran out of time or had more than 400 matches.

- The search runs only when Hedge would act, so asked tickets cost no extra request.
- The query holds up to eight lowercase ASCII words and no text from the ticket beyond them, so a
  summary cannot change the query. Stop words and words with punctuation inside are left out,
  since Jira's index may drop or split them.
- The result only ever moves from act to ask, so the error bound cannot get worse from it.

## Limits

- Jira's index decides what the search returns. An issue it does not match, or that the reader
  cannot see, is not compared.
- Very new issues may not be indexed yet. Those are in the window, which is read by date.
- A ticket whose summary has no searchable word is asked about, if its text is not empty.
- A short, common summary such as "Build failed" can match more than 400 issues, which asks.
  How often this happens on a real site is not measured.
