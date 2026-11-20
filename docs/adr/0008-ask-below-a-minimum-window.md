# 8. Ask about every ticket below a minimum window

Date: 2026-11-20. Status: accepted.

## Context

The judge guide ([TESTING.md](../TESTING.md)) asks a judge to create ten tickets in an
empty project, then an eleventh that restates the first. Replaying exactly that through the
app's triage with the installed 3% clear policy, every one of the eleven was **cleared as
new**, including the restated one, whose top candidate was the right earlier ticket.

The cause is the window size feature. The clear gate gives `logWindow` a weight of -0.27,
so a ten-issue window adds about +1.2 to the logit against a full one. In the data this
is right: on the fresh calibration sample below, the 87 tickets (0.6%) that searched fewer
than 30 earlier issues have no duplicates at all, since a project that young has little to
duplicate. A judge's site is not that population. A judge plants a duplicate on purpose,
and the gate is extrapolating from a corner calibration barely covers (in the old calibration
sample, 99% of tickets searched 58 or more issues).

The guarantee is marginal. It bounds the error rate over tickets like the calibration
set, so a new site with a planted duplicate is outside what it promises. The app should
say so rather than act.

## Decision

The policy carries `minWindow`. When a project has fewer earlier issues than that, both
gates ask, whatever the score. `calibrate.py --min-window` applies the same rule before
certification: those calibration tickets count as asked, never as acted, so the certified
error rate is the error rate of the rule the app runs. A policy without a valid
`minWindow` never acts. The installed value is 30.

The cut was picked while looking at the old calibration sample. A cut of 100 was also
tried there and dropped the certified share at 3% from 59.9% to 43.4%. Picking between
two rules on the data that certifies one of them would spend the guarantee's delta. So
the rule is certified on a **fresh calibration draw**: `rows.py --fresh-calibration`
samples 20,000 new calibration tickets (14,107 without Mojang) from the same period that
are not in the old sample. Train and test rows are copied unchanged.

The first fresh draw also dropped every ticket sharing a duplicate cluster with the old
sample. That looked stricter but biased the draw: which clusters a sample touches depends
on the labels, big clusters are hit far more often, and the draw was left with 2.95%
duplicates per ticket against 3.34% in the old sample, so it certified optimistically
(the review caught it before release). Dropping only the old tickets gives 3.09%. A few
tickets still share a cluster with the old sample; under 5% of calibration tickets are in
any cluster at all.

Paying for the choice by certifying at delta / 2 on the old sample was the alternative.
It costs as much as ADR 7's split: at 3% the certified share fell from 59.9% to 44.5%.

## Results (without Mojang, fresh calibration, same test split)

| Rule | Certified at 3% (calibration) | Test coverage | Test error |
|---|---|---|---|
| No minimum window | 83.4% | 80.4% [75.1%, 84.6%] | 1.8% [1.3%, 2.3%] |
| Minimum window 30 (installed) | 82.8% | 79.6% [74.4%, 83.8%] | 1.8% [1.3%, 2.3%] |

The rule asks about 0.8% of test tickets and costs 0.8 points of coverage. Those tickets
were always right, so the 3% budget no longer leans on them. The 2% row certifies nothing
with or without the rule.

## Consequences

- The ten-ticket walkthrough now gets "Needs a person" with the reason "This project has N
  earlier issues. Hedge needs at least 30". `app/test/triage.test.js` replays it against
  the installed policy, so a future policy that clears the restated ticket fails CI.
- A judge needs a project with history to see Hedge act. The sample-data seeder on the
  admin page is how they get one.
- The certified coverage at 3% moved from 59.9% to 79.7% between two calibration draws of
  the same period with the same rule. Coverage sits on a steep part of the score curve,
  so draw to draw it swings far more than the error does. The README reports the test
  interval, not the calibration point.
