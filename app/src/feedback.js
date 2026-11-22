// People's verdicts on Hedge's calls, from the issue panel: right or wrong.
//
// The certified budget says at most alpha of Hedge's actions are wrong on tickets like the
// calibration ones. This is the check on the tickets it actually sees: the share of
// reviewed actions that people marked wrong, which the admin page shows next to the
// budget. The decision a verdict refers to is Hedge's latest logged one, never taken
// from the caller, so a panel cannot file a verdict on a call Hedge did not make.

import { readDecision } from './log.js';

export const FEEDBACK_SIZE = 500;
const KEY = 'log:feedback';
const VERDICTS = ['right', 'wrong'];

export async function readFeedback(store) {
  try {
    const list = await store.get(KEY);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveFeedback(store, { issueKey, verdict, at = new Date().toISOString() }) {
  if (!VERDICTS.includes(verdict)) throw new Error('A verdict must be right or wrong.');
  const decided = await readDecision(store, issueKey);
  if (!decided) throw new Error(`Hedge has no decision on ${issueKey} to review.`);
  const entry = { issueKey, decision: decided.decision, verdict, at };
  const rest = (await readFeedback(store)).filter((f) => f.issueKey !== issueKey);
  await store.set(KEY, [entry, ...rest].slice(0, FEEDBACK_SIZE));
  return entry;
}

// Link and clear are actions; an ask hands the ticket to a person, so it is no error
// against the budget and is counted apart.
export function feedbackSummary(feedback) {
  const list = Array.isArray(feedback) ? feedback : [];
  const acted = list.filter((f) => f?.decision === 'link' || f?.decision === 'clear');
  const wrong = acted.filter((f) => f.verdict === 'wrong').length;
  return {
    reviewed: acted.length,
    wrong,
    rate: acted.length > 0 ? wrong / acted.length : null,
    asks: list.filter((f) => f?.decision === 'ask').length,
  };
}
