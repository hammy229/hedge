# 2. Certify on one ticket per cluster

Date: 2026-11-15. Status: accepted.

## Context

Learn then Test certifies a threshold with a binomial test: among the n calibration tickets
the gate would act on, k were wrong, and the p-value is P(Binomial(n, alpha) <= k). That
treats each ticket as an independent trial.

Jira tickets are not independent. One bug is often filed many times in a burst, and those
duplicates tend to be easy or hard together: if the retriever gets one right, it gets the
rest right. A code review of the calibration path pointed out that nothing checked this.

## What the data showed

A simulation where every ticket in a cluster shares one score and one outcome, the worst
case, 400 calibration draws each, alpha = delta = 0.1:

| Calibration data | Draws that certified a threshold with true error above 10% |
|---|---|
| 500 independent tickets | 0.0% |
| 50 clusters of 10 tickets | 24.8% |
| 25 clusters of 20 tickets | 38.3% |
| 50 clusters of 10, one ticket per cluster | 0.0% |
| 25 clusters of 20, one ticket per cluster | 0.0% |

The guarantee promises at most 10%. Counting a cluster of 20 as 20 trials broke it almost
four times over.

## Decision

`ltt_threshold(..., groups=...)` keeps one randomly chosen ticket per group before testing,
and `calibrate` passes each row's `group` (its duplicate cluster, or its project when no
cluster applies). The policy's `calibrationSize` reports the number of groups, not rows,
because that is the real amount of evidence.

## Consequences

- The guarantee now rests on clusters being exchangeable, a weaker and more believable
  assumption than tickets being independent.
- Calibration sets get smaller. On real data the README will report rows and groups.
- Real clusters are less extreme than the simulation, so thinning gives up some coverage
  when correlation is mild. A cluster-aware bound that uses every row is a possible upgrade.
- The splits must also keep each cluster on one side (train, calibration or test), or
  calibration and test stop being exchangeable. That is the next item in the plan.
