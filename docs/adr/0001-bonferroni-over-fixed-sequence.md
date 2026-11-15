# 1. Bonferroni over a fixed grid, not fixed sequence testing

Date: 2026-11-15. Status: accepted.

## Context

Hedge certifies a threshold so that, among tickets it acts on, at most alpha are wrong with
probability at least 1 - delta (Learn then Test, Angelopoulos et al. 2021). Each candidate
threshold t gets the null "selective risk at t is above alpha" and a binomial tail p-value.
Some multiple-testing rule then decides which nulls to reject.

The first version used fixed sequence testing over the observed scores, strictest first,
stopping at the first null it could not reject. That needs no correction to delta, so it
looked like the tighter choice.

## What happened

On a synthetic set of 5,000 tickets where the oracle threshold acts on 40% of them, it
certified nothing and the gate never acted. The strictest candidate acts on one ticket.
Even with zero errors its p-value is 1 - alpha = 0.9, far above delta = 0.1, so the
sequence stops at step one. The same failure hit a hand-built case with 3 perfect answers.

## Decision

Test every point of a fixed grid of 101 thresholds in [0, 1] at level delta / 101 and take
the most lenient certified threshold. Bonferroni is valid under any dependence between the
tests and needs no monotonicity of risk in t. The grid is fixed before seeing data, which is
why gate scores must be probabilities.

## Consequences

- On the same 5,000-ticket set the certified threshold is 0.72 and acts on 28.6% of tickets
  (oracle 40%). `ml/tests/test_risk.py` checks it stays between 25% and 45%.
- Over 400 calibration draws of 500 tickets, 0 certified a threshold whose true selective
  risk exceeds alpha = 0.1 (allowed: delta = 10%). So the bound holds with room to spare,
  and the room is coverage left on the table.
- The price is a log(101) factor inside the binomial bound. It shows up as slightly lower
  coverage on small calibration sets, and the evaluation reports it rather than hiding it.
- A later option is fixed sequence testing that starts at a data-independent minimum
  coverage. It is not needed unless the coverage gap matters in the real results.
