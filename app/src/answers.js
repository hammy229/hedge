// A person's answer to a ticket Hedge asked about: a new report, or a duplicate. Answering
// takes the ticket out of the hedge-ask queue. Answers are kept apart from verdicts
// (feedback.js), since an ask is not an action and never counts against the budget.
//
// The label decides what is in the queue, so tickets labeled by hand can be answered too.
// It comes off first, as the person. If Jira refuses, nothing is stored, so an
// answered ticket is never left in the queue.
//
// A duplicate answer may name the earlier issue. Then the link is written first, so a
// refused link leaves the ticket in the queue instead of dropping what the person said.

export const ANSWER_PREFIX = 'answer:';
const ANSWERS = ['new', 'duplicate'];

export async function saveAnswer(store, leave, { issueKey, answer, duplicateOf = null, accountId = null, at = new Date().toISOString() }, link = null) {
  if (!ANSWERS.includes(answer)) throw new Error('An answer must be new or duplicate.');
  const named = duplicateOf !== null && duplicateOf !== undefined;
  if (named) {
    if (answer !== 'duplicate') throw new Error('Only a duplicate names an earlier issue.');
    if (typeof link !== 'function') throw new Error('Links cannot be written here.');
    const linked = await link(issueKey, duplicateOf);
    if (linked?.ok !== true) throw new Error(linked?.error ?? 'Jira could not be updated.');
  }
  const left = await leave(issueKey);
  if (left?.ok !== true) throw new Error(left?.error ?? 'Jira could not be updated.');
  const entry = { issueKey, answer, accountId: typeof accountId === 'string' ? accountId : null, at };
  if (named) entry.duplicateOf = duplicateOf;
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

export async function readAnswer(store, issueKey) {
  return (await store.get(`${ANSWER_PREFIX}${issueKey}`)) ?? null;
}
