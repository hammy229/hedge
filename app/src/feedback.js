// People's verdicts on Hedge's calls, from the issue panel: right or wrong.
//
// The certified budget says at most alpha of Hedge's actions are wrong on tickets like the
// calibration ones. This is the check on the tickets it actually sees: the share of
// applied actions that people marked wrong, which the admin page shows next to the
// budget. The decision a verdict refers to is Hedge's logged one, never taken from the
// caller, so a panel cannot file a verdict on a call Hedge did not make.
//
// Each person's verdict on an issue has its own key. A person can change their own, but
// nobody can erase someone else's, and a call counts as wrong if anyone says so. Otherwise
// one click on Right could hide the verdict that would have paused Hedge (pause.js).

import { readDecision } from './log.js';

export const FEEDBACK_PREFIX = 'feedback:';
const VERDICTS = ['right', 'wrong'];

const feedbackKey = (f) => `${FEEDBACK_PREFIX}${f.issueKey}:${f.accountId ?? 'unknown'}`;

// One entry per issue: any wrong verdict on it wins.
export function perIssue(feedback) {
  const byIssue = new Map();
  for (const f of Array.isArray(feedback) ? feedback : []) {
    if (!f || typeof f !== 'object') continue;
    const seen = byIssue.get(f.issueKey);
    if (!seen || (seen.verdict !== 'wrong' && f.verdict === 'wrong')) byIssue.set(f.issueKey, f);
  }
  return [...byIssue.values()];
}

// Every stored verdict, with `saved` put in by hand because the list may lag the write.
// Unlike readFeedback, storage errors are thrown.
export async function feedbackWith(store, saved = null) {
  const list = await store.list(FEEDBACK_PREFIX);
  if (!saved) return list;
  return [...list.filter((f) => f && feedbackKey(f) !== feedbackKey(saved)), saved];
}

export async function readFeedback(store) {
  try {
    const list = await store.list(FEEDBACK_PREFIX);
    return Array.isArray(list) ? list.filter((f) => f && typeof f === 'object') : [];
  } catch {
    return [];
  }
}

export async function saveFeedback(store, { issueKey, verdict, accountId = null, at = new Date().toISOString() }) {
  if (!VERDICTS.includes(verdict)) throw new Error('A verdict must be right or wrong.');
  const decided = await readDecision(store, issueKey);
  if (!decided) throw new Error(`Hedge has no decision on ${issueKey} to review.`);
  const entry = {
    issueKey,
    decision: decided.decision,
    via: decided.via ?? null,
    applied: decided.applied === true,
    budget: Number.isFinite(decided.budget) ? decided.budget : null,
    decidedAt: typeof decided.at === 'string' ? decided.at : null,
    verdict,
    accountId: typeof accountId === 'string' ? accountId : null,
    at,
  };
  await store.set(feedbackKey(entry), entry);
  return entry;
}

// Only link and clear calls the trigger carried out count against the budget: a call
// that was only shown in the panel changed nothing, and an ask hands the ticket to a
// person. Both are counted apart.
export function feedbackSummary(feedback) {
  const list = perIssue(feedback);
  const isAction = (f) => f.decision === 'link' || f.decision === 'clear';
  const acted = list.filter((f) => isAction(f) && f.applied === true);
  const wrong = acted.filter((f) => f.verdict === 'wrong').length;
  return {
    reviewed: acted.length,
    wrong,
    rate: acted.length > 0 ? wrong / acted.length : null,
    asks: list.filter((f) => f.decision === 'ask').length,
    shownOnly: list.filter((f) => isAction(f) && f.applied !== true).length,
  };
}
