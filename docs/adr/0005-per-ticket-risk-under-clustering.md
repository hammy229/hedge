# 5. Bound per-ticket risk under clustering, instead of testing one ticket per cluster

Date: 2026-11-17. Status: accepted. Supersedes the decision in [ADR 2](0002-certify-one-ticket-per-cluster.md).

## Context

ADR 2 fixed a real problem: duplicates of one bug succeed or fail together, so counting
them as independent trials made the binomial test overconfident. Its fix was to test one
random ticket per duplicate cluster.

That fix changes what is being measured. The guarantee an admin reads is about tickets:
"at most 3% of the tickets Hedge acts on are wrong". One ticket per cluster estimates the
error rate over *clusters*. The two agree when every cluster has the same size, which is
what ADR 2's synthetic test used. They disagree when cluster size tracks the outcome, and
in Jira it does.

## What the data showed

Two actions are certified separately (see `hedge.calibrate.ACTIONS`): **link** a new
ticket to its top candidate, or **clear** it as a new report so nobody checks it for
duplicates. Clearing is wrong exactly when the ticket has an earlier duplicate. New reports
are singletons, and duplicates arrive in bursts, many per cluster.

On 20,000 sampled calibration tickets (temporal split, `hedge.rows`):

| Measure | Value |
|---|---|
| Tickets with an earlier duplicate, per ticket | 15.1% |
| Same, one ticket per cluster | 8.2% |
| Largest cluster in the sample (a Mojang hub) | 276 tickets |

With one ticket per cluster, the clear action was certified at a 10% budget for every
ticket, and the test window then showed 15.4% wrong. At 5% it was certified on 14.9% of
tickets and the test window showed 6.9% wrong. The failure is on calibration itself, not
drift: calibration's per-ticket rate was already 15.1%.

A synthetic check isolates it (`tests/test_risk.py`, 300 trials): 300 singleton tickets
2% wrong, 15 clusters of 20 that are all right or all wrong, true per-ticket risk 26% at
every threshold, budget 10%. One ticket per cluster certified a threshold in 83.7% of
trials, against the 10% allowed.

## Decision

Keep every calibration ticket and count errors per cluster. `risk.clustered_p_value` gives
a p-value for "per-ticket selective risk is above alpha" that holds when clusters are
independent and tickets inside a cluster depend on each other in any way:

- A cluster with A acted tickets has E errors in [0, A]. By convexity its moment
  generating function is at most that of A times a Bernoulli: the all-or-nothing cluster
  is the worst case.
- Under the null the clusters' error rates average at least alpha, weighted by A. The
  worst case puts the error mass on the largest clusters first (a fractional knapsack).
- A Chernoff bound over a fixed grid of exponents gives the p-value. With clusters of one
  it is the Poisson Chernoff bound, a little looser than the exact binomial.

Learn then Test still uses Bonferroni over the threshold grid. The old test remains as
`grouped="one-per-group"` for comparison.

## Results

Same rows, same gate, test window after calibration (`python -m hedge.report`):

| Clear action | One ticket per cluster: test error | Cluster bound: test coverage, test error |
|---|---|---|
| 5% budget | 6.9% (over budget) | 7.4%, 1.4% |
| 10% budget | 15.4% (over budget) | 13.3%, 6.9% |

On the synthetic check the bound certified in 1.3% of trials, and it still holds on ADR
2's equal-size clusters. Every threshold it certified on the real data stayed within
budget on the test window, with and without Mojang.

## Consequences

- At a 3% budget with Mojang included, nothing is certified now; the old test certified
  acting on 9.0%. That number came from a test that measured the wrong quantity, so
  losing it is correct.
- The bound is conservative for singletons (Chernoff instead of exact binomial). A
  tighter test that is exact on singletons and uses the bound only for multi-ticket
  clusters is a possible next step.
- The independence assumption moves from tickets to clusters. Hub clusters that ADR 3
  splits for labeling stay whole here, because their reports are correlated.
