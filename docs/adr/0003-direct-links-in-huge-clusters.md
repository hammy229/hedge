# 3. Label huge duplicate clusters by direct links only

Date: 2026-11-16. Status: accepted.

## Context

Hedge's labels say which earlier issues are correct answers for a new issue. Week 0 built
them from the transitive closure of Duplicate links: if A duplicates B and B duplicates C,
all three are one cluster, and every earlier member is a correct answer.

## What the data showed

On the full Public Jira Dataset (2,686,282 issues, 271,185 distinct Duplicate pairs, 76,384
clusters) the closure is right for nearly every cluster: median size 2, 90th percentile 5,
99th percentile 35. It is badly wrong for a few. The two largest clusters hold 23,292 and
21,084 issues, all in Mojang's Jira. They form around catch-all tickets that collect
thousands of direct duplicates each, for example:

| Hub ticket | Direct duplicates |
|---|---|
| MCPE-36190 "Multiplayer Connection Issues and Workarounds" | 1,869 |
| MCPE-21416 "Mobs and Entities can despawn randomly" | 1,676 |
| MC-32606 "JVM Crash in ig#icd64.dll" | 1,168 |

One stray link between two hubs merges their reports, so a connection bug becomes the
"duplicate" of a despawning bug. Across the dataset the closure produces 500,219,881
(issue, correct answer) pairs, with up to 23,291 correct answers for a single issue.

## Decision

`dupes.duplicate_labels(links, created, max_cluster=100)` keeps the closure for clusters of
at most 100 issues. In a larger cluster an issue's correct answers are only the earlier
issues it is directly linked to. 174 clusters (76,913 issues) are above the cap. With it,
265,791 issues have at least one earlier duplicate, with 1,709,037 answer pairs in total and
at most 178 for one issue.

The cluster id is still used for grouping (bootstrap and one ticket per cluster in
calibration), because hub reports are correlated even if they are not the same bug.

## Consequences

- Recall@k on Mojang can no longer be inflated by matching any of 20,000 loosely linked
  issues.
- The cap is a judgment call. Results will be reported at the default and with the closure
  for clusters up to 35 (the 99th percentile) to show the choice does not drive them.
- `max_cluster=None` reproduces the old labels.
