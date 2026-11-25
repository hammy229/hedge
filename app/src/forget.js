// Hedge used to store the account id of whoever gave a verdict or an answer. This rewrites
// what is left of that, a batch at a time. The admin page calls it apart from its other reads,
// so neither can hold up the other. The new verdict is written before the old one goes, so a
// crash in between leaves two marks of one person, which feedback.js counts as one call.

import { ANSWER_PREFIX } from './answers.js';
import { FEEDBACK_PREFIX } from './feedback.js';
import { personMark } from './person.js';

export const BATCH = 25;

const old = (e) => e && typeof e === 'object' && 'accountId' in e;

// The person may save a verdict between the read and the write. Theirs stays.
const ignoreExisting = (store, k) => async (e) => {
  if (!(await store.get(k))) throw e;
};

export async function forgetAccounts(store) {
  const verdicts = (await store.list(FEEDBACK_PREFIX)).filter(old);
  const answers = (await store.list(ANSWER_PREFIX)).filter(old);
  let changed = 0;
  for (const e of verdicts.slice(0, BATCH)) {
    const { accountId, ...rest } = e;
    const person = await personMark(store, e.issueKey, accountId);
    const to = `${FEEDBACK_PREFIX}${e.issueKey}:${person ?? 'unknown'}`;
    // A verdict the person gave since then is newer than the one being moved.
    if (!person) await store.set(to, { ...rest, person: null });
    else if (!(await store.get(to))) await store.create(to, { ...rest, person }).catch(ignoreExisting(store, to));
    if (person) await store.delete(`${FEEDBACK_PREFIX}${e.issueKey}:${accountId}`);
    changed += 1;
  }
  for (const e of answers.slice(0, BATCH - changed)) {
    const now = await store.get(`${ANSWER_PREFIX}${e.issueKey}`);
    if (!old(now)) continue; // answered again since
    const { accountId, ...rest } = now;
    await store.set(`${ANSWER_PREFIX}${e.issueKey}`, rest);
    changed += 1;
  }
  return { changed, left: Math.max(0, verdicts.length + answers.length - BATCH) };
}
