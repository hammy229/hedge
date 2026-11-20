# 7. Certify every dial budget at the full delta

Date: 2026-11-19. Status: accepted.

## Context

The admin page lets a site admin pick the error budget: how often Hedge may be wrong
among the tickets it acts on. The admin chooses after seeing what each budget buys, so a
threshold certified for one budget chosen in advance is not enough. The guarantee has to
hold for whichever row the admin ends up picking.

The obvious fix is a union bound across budgets: certify each of k budgets at delta / k.
On the real calibration window with five budgets that cost a lot. At 3% the certified
share of tickets Hedge clears fell from 59.9% to 43.4%.

## Decision

Certify every budget at the full delta. `calibrate.py --budgets` writes one row per budget
into `policy.js`, and `app/src/budget.js` uses only those rows. A budget that is not in the
table, or a row that fails validation, closes the gate.

This holds simultaneously for every budget, at no extra cost. Learn then Test rejects
"the error rate above threshold t is more than alpha" when p(t, alpha) <= delta / m, where
m is the size of the fixed grid. Both p-values Hedge uses (exact binomial, and the
clustered bound) only fall as alpha grows. So for each t, the set of alphas the test
rejects is an interval [U(t), 1), and U(t) is an upper confidence bound on that
threshold's error. Bonferroni over the grid makes every U(t) hold at once with probability
at least 1 - delta. On that one event, every threshold certified for every budget is
correct. The budgets reuse the same event, so they don't need to split delta.

## Checks

- `test_binomial_p_value_never_rises_with_the_budget` and
  `test_clustered_p_value_never_rises_with_the_budget` check the monotonicity the argument
  needs.
- `test_every_budget_at_full_delta_holds_at_once`: over 400 synthetic calibration draws,
  the share where any of five budgets certified a threshold whose true error is above its
  budget stays within delta (plus Monte Carlo slack).
- `test_budget_table_costs_no_coverage_against_a_single_budget`: the default row equals a
  single-budget run exactly.

## Result on the real data (without Mojang)

| Budget | Certified share of calibration tickets cleared |
|---|---|
| 2% | 14.9% |
| 2.5% | 29.6% |
| 3% (default) | 59.9% |
| 3.5% | 85.3% |
| 5% | 100% (duplicates are 3.3% of calibration tickets, so clearing everything fits) |

The steep rise near 3% is real: duplicates are rare, so a budget near the base rate lets
Hedge clear almost everything. Link certifies nothing at any of these budgets, as before.

## Consequences

The dial can only move between thresholds the calibration certified. The guarantee still
assumes new tickets look like the calibration window, which is why the test window and
the held-out projects in [results](../results.md) are reported next to it.
