// People's verdicts on Hedge's calls, from the issue panel: right or wrong.
//
// The certified budget says at most alpha of Hedge's actions are wrong on tickets like the
// calibration ones. This is the check on the tickets it actually sees: the share of
// applied actions that people marked wrong, which the admin page shows next to the
// budget. The decision a verdict refers to is Hedge's logged one, never taken from the
// caller, so a panel cannot file a verdict on a call Hedge did not make.
//
// Each issue's verdict has its own key, so two people reviewing at once cannot drop each
// other's verdict, and a new verdict on the same issue replaces the old one.

import { readDecision } from './log.js';

const PREFIX = 'feedback:';
const VERDICTS = ['right', 'wrong'];

export async function readFeedback(store) {
  try {
    const list = await store.list(PREFIX);
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
    verdict,
    accountId: typeof accountId === 'string' ? accountId : null,
    at,
  };
  await store.set(`${PREFIX}${issueKey}`, entry);
  return entry;
}

// Only link and clear calls the trigger carried out count against the budget: a call
// that was only shown in the panel changed nothing, and an ask hands the ticket to a
// person. Both are counted apart.
export function feedbackSummary(feedback) {
  const list = Array.isArray(feedback) ? feedback.filter((f) => f && typeof f === 'object') : [];
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
