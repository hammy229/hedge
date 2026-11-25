// What each budget on the dial would have done with the tickets Hedge checked lately.
//
// Every ticket counts once, by its newest logged call. The log keeps the clear gate's score
// (triage.js), so a budget is compared by its certified threshold alone. Two things this
// cannot see: the search for old copies runs only when Hedge acts (copies.js), so a looser
// budget may act on slightly fewer tickets than shown, and the log knows nothing about which
// calls were right. It is a preview of how often Hedge would act, not of how often it errs.

const finite = (x) => typeof x === 'number' && Number.isFinite(x);

export function whatIf(log, policy) {
  const newest = new Map();
  for (const e of Array.isArray(log) ? log : []) {
    // Entries from before scores were kept, and reads that failed, say nothing.
    if (!e?.issueKey || e.clearScore === undefined || Number.isNaN(Date.parse(e.at))) continue;
    const seen = newest.get(e.issueKey);
    if (!seen || seen.at < e.at) newest.set(e.issueKey, e);
  }
  const scores = [...newest.values()].map((e) => e.clearScore);
  const rows = (Array.isArray(policy?.budgets) ? policy.budgets : [])
    .filter((b) => finite(b?.alpha))
    .map((b) => {
      const open = b.calibrated === true && finite(b.threshold) && b.threshold > 0;
      return { alpha: b.alpha, acts: open ? scores.filter((s) => finite(s) && s >= b.threshold).length : 0 };
    })
    .sort((a, b) => a.alpha - b.alpha);
  return { tickets: scores.length, rows };
}
