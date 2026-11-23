# ADR 9: pause on evidence that survives repeated checks

Status: accepted, Nov 23 2026

## Context

The certified budget holds for tickets that look like the calibration set. On a real site
they may not: held-out projects had test errors of 1.4% to 2.5%, with an upper end of 3.2%.
People already mark calls right or wrong in the panel, but the admin page only displayed the
share. Nothing changed when it went over the budget.

The check has to run after every verdict, because waiting for a fixed sample means acting
wrongly in the meantime. A binomial test at 5% repeated after each verdict goes wrong far
more often than 5% of the time.

## Decision

Each verdict is a bet against "the error rate is at most the budget". For a guessed rate q
above the budget alpha, a wrong call multiplies the bet by q / alpha and a right one by
(1 - q) / (1 - alpha). While the error rate is at most alpha, the factor averages at most 1,
so by Ville's inequality the value ever reaches 20 with probability at most 1/20. Five bets
(1.5, 2, 3, 5 and 10 times the budget) are averaged, since the true rate is not known. alpha
is the budget each call was made under, so the dial may move between calls.

At 20 the action is paused: its gate closes in the panel, the trigger, the agent and MCP. The
pause stays until an admin resumes it, and then only later calls count. If the pause state
cannot be read, the action counts as paused.

Only calls the trigger carried out count, once per ticket. A call is wrong if any person
marked it wrong.

## Results (simulated, 1,000 sites, 200 verdicts each, checked after every one)

| True error rate, 3% budget | Paused |
|---|---|
| 3% (exactly at the budget) | 2.1% |
| budgets moving between 2.5% and 5%, error always at the budget | 1.9% |
| 6% (twice the budget) | 41.7% |
| 15% (five times) | 100% |

Wrong verdicts that pause a 3% budget: 2 of 2, 3 of 10, 4 of 20, 5 of 30, 6 of 50, 9 of 100.

## Limits

- It finds large excesses, not small ones: at twice the budget, 200 verdicts catch 41.7%.
- Verdicts are voluntary. People check calls they doubt, so the reviewed share is likely worse
  than the true one, and Hedge pauses more easily. The 5% is about reviewed calls.
- People may change their own verdict, and anyone's wrong verdict wins. The bound is exact
  for verdicts given once.
- 5% is per action and per resume, not for the life of a site.
- Verdicts are read up to 5,000 at a time. Past that, the check sees only part of them.
- Anyone who can open an issue's panel can add to a pause. Only an admin can lift it.
