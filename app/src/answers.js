// A person's answer to a ticket Hedge asked about: a new report, or a duplicate. Answering
// takes the ticket out of the hedge-ask queue. Answers are kept apart from verdicts
// (feedback.js), since an ask is not an action and never counts against the budget.
//
// The label comes off first, as the person. If Jira refuses, nothing is stored, so an
// answered ticket is never left in the queue.

import { readDecision } from './log.js';

export const ANSWER_PREFIX = 'answer:';
const ANSWERS = ['new', 'duplicate'];

export async function saveAnswer(store, leave, { issueKey, answer, accountId = null, at = new Date().toISOString() }) {
  if (!ANSWERS.includes(answer)) throw new Error('An answer must be new or duplicate.');
  if ((await readDecision(store, issueKey))?.via !== 'trigger') throw new Error(`Hedge did not put ${issueKey} in the queue.`);
  const left = await leave(issueKey);
  if (left?.ok !== true) throw new Error(left?.error ?? 'Jira could not be updated.');
  const entry = { issueKey, answer, accountId: typeof accountId === 'string' ? accountId : null, at };
  await store.set(`${ANSWER_PREFIX}${issueKey}`, entry);
  return entry;
}

export async function answerSummary(store) {
  let list;
  try {
    list = await store.list(ANSWER_PREFIX);
  } catch {
    return null;
  }
  const count = (answer) => (Array.isArray(list) ? list : []).filter((a) => a?.answer === answer).length;
  return { fresh: count('new'), duplicate: count('duplicate') };
}
