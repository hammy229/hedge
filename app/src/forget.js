// Hedge used to store the account id of whoever gave a verdict or an answer. This rewrites
// what is left of that. The admin page runs it when it loads; with nothing to do it only
// reads. The new verdict is written before the old one goes, so a crash in between leaves two
// marks of one person, which feedback.js counts as one call.

import { ANSWER_PREFIX } from './answers.js';
import { FEEDBACK_PREFIX } from './feedback.js';
import { personMark } from './person.js';

const old = (e) => e && typeof e === 'object' && 'accountId' in e;

export async function forgetAccounts(store) {
  let changed = 0;
  for (const e of (await store.list(FEEDBACK_PREFIX)).filter(old)) {
    const { accountId, ...rest } = e;
    const person = await personMark(store, e.issueKey, accountId);
    const to = `${FEEDBACK_PREFIX}${e.issueKey}:${person ?? 'unknown'}`;
    // A verdict the person gave since then is newer than the one being moved.
    const newer = person ? await store.get(to) : null;
    if (!newer) await store.set(to, { ...rest, person });
    if (person) await store.delete(`${FEEDBACK_PREFIX}${e.issueKey}:${accountId}`);
    changed += 1;
  }
  for (const e of (await store.list(ANSWER_PREFIX)).filter(old)) {
    const { accountId, ...rest } = e;
    await store.set(`${ANSWER_PREFIX}${e.issueKey}`, rest);
    changed += 1;
  }
  return changed;
}
