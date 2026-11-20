// The admin's error-budget dial.
//
// calibrate.py --budgets certifies a table of budgets for each action, every one at the
// full delta (ADR 7), so an admin may switch to any row after seeing the table. This file
// turns a chosen budget into the policy the gate reads. Anything it cannot match exactly,
// a budget missing from the table or a malformed row, becomes an uncalibrated policy, so
// the gate asks: the dial can only ever pick a threshold the calibration certified.

const closed = (policy, why) => ({ ...policy, calibrated: false, threshold: null, closedBecause: why });

export function atBudget(policy, alpha) {
  if (alpha === undefined || alpha === policy?.alpha) return policy;
  if (typeof alpha !== 'number' || !Number.isFinite(alpha)) return closed(policy, 'The budget is not a number.');
  const row = Array.isArray(policy?.budgets) ? policy.budgets.find((b) => b?.alpha === alpha) : undefined;
  if (!row) return closed(policy, `No threshold was certified for a ${pct(alpha)} budget.`);
  if (row.calibrated !== true) return closed(policy, `Nothing was certified at a ${pct(alpha)} budget.`);
  // gate.policyProblem checks the threshold range, so a bad one closes the gate there.
  return {
    ...policy,
    alpha: row.alpha,
    threshold: row.threshold,
    calibrationCoverage: row.calibrationCoverage,
    calibrationActed: row.calibrationActed,
    calibrationErrors: row.calibrationErrors,
  };
}

// The rows the admin page shows, in budget order. A policy without a table offers only
// its own budget.
export function budgetOptions(policy) {
  const rows = Array.isArray(policy?.budgets) && policy.budgets.length > 0 ? policy.budgets : [policy ?? {}];
  return rows
    .filter((b) => typeof b?.alpha === 'number')
    .map((b) => {
      const certified = b.calibrated === true;
      const coverage = certified ? b.calibrationCoverage : 0;
      return {
        alpha: b.alpha,
        certified,
        coverage,
        isDefault: b.alpha === policy.alpha,
        label: certified
          ? `${pct(b.alpha)} budget: acts on ${(coverage * 100).toFixed(1)}% of tickets`
          : `${pct(b.alpha)} budget: nothing certified, always asks`,
      };
    })
    .sort((a, b) => a.alpha - b.alpha);
}

function pct(alpha) {
  return `${+(alpha * 100).toFixed(2)}%`;
}
