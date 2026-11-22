// A short audit trail of Hedge's decisions, kept in Forge storage so it never leaves
// Atlassian. Each entry says what Hedge did, why, at which budget and threshold, and
// whether the call came from the issue panel or an agent over MCP. Ticket text is not
// copied, only the key. Keys and reasons still span every project, so only the admin
// page may read the log (resolver.js).
//
// The log is one capped list. Two triages finishing at the same moment can drop one
// entry; that is accepted for a recent-activity view, and a full audit store would use
// one key per entry instead.

export const LOG_SIZE = 50;
const KEY = 'log:decisions';

const finite = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function entryFor(result, { budgets = {}, via, at = new Date().toISOString() } = {}) {
  const gates = result?.gates ?? {};
  const acting = result?.decision === 'link' ? gates.link : result?.decision === 'clear' ? gates.clear : null;
  const scores = Object.values(gates).map((g) => finite(g?.score)).filter((s) => s !== null);
  const action = acting === gates.link ? 'link' : 'clear';
  return {
    at,
    issueKey: String(result?.issueKey ?? ''),
    decision: String(result?.decision ?? 'ask'),
    reason: String(result?.reason ?? ''),
    score: acting ? finite(acting.score) : scores.length > 0 ? Math.max(...scores) : null,
    threshold: acting ? finite(acting.threshold) : null,
    budget: acting ? finite(budgets[action]) : null,
    via: String(via ?? 'unknown'),
    // Only the issue trigger carries decisions out; the panel and MCP only report them.
    applied: typeof result?.applied?.applied === 'boolean' ? result.applied.applied : null,
  };
}

export async function readLog(store) {
  try {
    const log = await store.get(KEY);
    return Array.isArray(log) ? log : [];
  } catch {
    return [];
  }
}

// Same ticket, outcome, budget and caller as an earlier entry: the panel re-runs triage
// each time someone opens the ticket, and a view is not a new decision.
const same = (a, b) =>
  a.issueKey === b.issueKey && a.decision === b.decision && a.budget === b.budget && a.via === b.via;

// The latest decision on each issue also gets a key of its own, so a verdict from the
// panel (feedback.js) finds it after the capped list has moved on.
const decisionKey = (issueKey) => `decision:${issueKey}`;

export async function readDecision(store, issueKey) {
  try {
    const entry = await store.get(decisionKey(issueKey));
    return entry && typeof entry === 'object' && entry.issueKey === issueKey ? entry : null;
  } catch {
    return null;
  }
}

export async function record(store, result, meta) {
  try {
    const log = await readLog(store);
    const entry = entryFor(result, meta);
    if (entry.issueKey) await store.set(decisionKey(entry.issueKey), entry);
    if (log.some((e) => same(e, entry))) return;
    await store.set(KEY, [entry, ...log].slice(0, LOG_SIZE));
  } catch {
    // The log is a record of decisions, not part of them.
  }
}
