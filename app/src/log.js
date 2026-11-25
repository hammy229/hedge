// A short audit trail of Hedge's decisions, kept in Forge storage so it never leaves
// Atlassian. Each entry says what Hedge did, why, at which budget and threshold, and
// whether the call came from the issue panel or an agent over MCP. Ticket text is not
// copied, only the key. Keys and reasons still span every project, so only the admin
// page may read the log (resolver.js).
//
// Each entry has its own key, so triages finishing at the same moment cannot drop each
// other's. The key names the ticket, outcome, budget and caller, so reopening a ticket is
// not a new entry. Entries expire by themselves. Forge may keep one up to two days past its
// expiry and promises no order, so readLog sorts and cuts. The latest call shown on an issue
// lasts half a year; what the trigger did to it stays, since its label does too.

export const LOG_SIZE = 50;
export const LOG_PREFIX = 'entry:';
const DAY_MS = 86400000;
const LOG_DAYS = 30;
const DECISION_DAYS = 180;
const ttl = (value) => ({ ttl: { value, unit: 'DAYS' } });

const finite = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function entryFor(result, { budgets = {}, via, at = new Date().toISOString() } = {}) {
  const gates = result?.gates ?? {};
  const acting = result?.decision === 'link' ? gates.link : result?.decision === 'clear' ? gates.clear : null;
  const scores = Object.values(gates).map((g) => finite(g?.score)).filter((s) => s !== null);
  const action = acting === gates.link ? 'link' : 'clear';
  const entry = {
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
  // Only triages that reached the gates have one; null means no budget would clear it.
  if (result?.clearScore !== undefined) entry.clearScore = finite(result.clearScore);
  // Why a call was not carried out. act.js keeps Jira's text out of it, so it is a fixed
  // message or a status, and the log is admin-only anyway.
  if (entry.applied === false && result?.applied?.error) entry.appliedError = String(result.applied.error).slice(0, 300);
  return entry;
}

export async function readLog(store, now = Date.now()) {
  try {
    const all = await store.list(LOG_PREFIX);
    return (Array.isArray(all) ? all : [])
      .filter((e) => e && typeof e === 'object' && Date.parse(e.at) >= now - LOG_DAYS * DAY_MS)
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, LOG_SIZE);
  } catch {
    return [];
  }
}

const logKey = (e) => `${LOG_PREFIX}${e.issueKey}:${e.decision}:${e.budget ?? 'none'}:${e.via}`;

// The latest decision on each issue also gets a key of its own, so a verdict from the
// panel (feedback.js) finds it after the log entry expired, and the trigger can
// tell an issue it already handled.
const decisionKey = (issueKey) => `decision:${issueKey}`;

// The trigger's entry is what Hedge actually did to the issue. It has a key of its own, so
// a panel view or agent call finishing at the same moment cannot overwrite it.
const actedKey = (issueKey) => `acted:${issueKey}`;

export async function readDecision(store, issueKey) {
  try {
    for (const k of [actedKey(issueKey), decisionKey(issueKey)]) {
      const entry = await store.get(k);
      if (entry && typeof entry === 'object' && entry.issueKey === issueKey) return entry;
    }
    return null;
  } catch {
    return null;
  }
}

export async function record(store, result, meta) {
  try {
    const entry = entryFor(result, meta);
    if (entry.issueKey && entry.via === 'trigger') await store.set(actedKey(entry.issueKey), entry);
    else if (entry.issueKey) await store.set(decisionKey(entry.issueKey), entry, ttl(DECISION_DAYS));
    const k = logKey(entry);
    const old = await store.get(k);
    const fresh = Date.parse(old?.at) >= Date.parse(entry.at) - LOG_DAYS * DAY_MS;
    if (!fresh || old.applied !== entry.applied) await store.set(k, entry, ttl(LOG_DAYS));
  } catch {
    // The log is a record of decisions, not part of them.
  }
}
