import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forgetAccounts } from '../src/forget.js';
import { feedbackSummary, readFeedback, saveFeedback } from '../src/feedback.js';
import { record } from '../src/log.js';
import { personMark } from '../src/person.js';

const memory = () => {
  const m = new Map();
  const secrets = new Map();
  return {
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    list: async (p) => [...m].filter(([k]) => k.startsWith(p)).map(([, v]) => v),
    getSecret: async (k) => secrets.get(k),
    createSecret: async (k, v) => {
      if (secrets.has(k)) throw new Error('exists');
      secrets.set(k, v);
    },
    m,
    secrets,
  };
};
const ID = '712020:abc-person';

test('a mark is stable for one person on one issue and differs otherwise', async () => {
  const store = memory();
  const mark = await personMark(store, 'P-1', ID);
  assert.match(mark, /^[0-9a-f]{32}$/);
  assert.equal(await personMark(store, 'P-1', ID), mark);
  assert.notEqual(await personMark(store, 'P-1', 'other'), mark);
  assert.notEqual(await personMark(store, 'P-2', ID), mark); // not linkable across issues
  assert.notEqual(await personMark(memory(), 'P-1', ID), mark); // or across sites
  assert.equal(await personMark(store, 'P-1', undefined), null);
});

test('two first verdicts at once agree on one secret', async () => {
  const store = memory();
  const [a, b] = await Promise.all([personMark(store, 'P-1', ID), personMark(store, 'P-1', ID)]);
  assert.equal(a, b);
  assert.equal(store.secrets.size, 1);
});

test('a secret that cannot be read or saved is an error, never a second vote', async () => {
  await assert.rejects(personMark({ getSecret: async () => { throw new Error('down'); } }, 'P-1', ID), /down/);
  await assert.rejects(personMark({ getSecret: async () => undefined, createSecret: async () => { throw new Error('full'); } }, 'P-1', ID), /full/);
});

const clear = (store, issueKey) => record(store, { issueKey, decision: 'clear', reason: 'r', gates: {}, applied: { applied: true } }, { via: 'trigger' });

test('no account id reaches storage with a verdict', async () => {
  const store = memory();
  await clear(store, 'P-1');
  await saveFeedback(store, { issueKey: 'P-1', verdict: 'wrong', accountId: ID });
  assert.equal(JSON.stringify([...store.m]).includes(ID), false);
});

test('old entries lose their account ids once, and each person keeps one verdict', async () => {
  const store = memory();
  const old = (accountId, verdict) => store.m.set(`feedback:P-1:${accountId ?? 'unknown'}`, { issueKey: 'P-1', decision: 'clear', applied: true, verdict, accountId });
  old(ID, 'wrong');
  old('b', 'right');
  old(null, 'right');
  store.m.set('answer:P-2', { issueKey: 'P-2', answer: 'new', accountId: ID, at: 't' });
  assert.equal(await forgetAccounts(store), 4);
  assert.equal(JSON.stringify([...store.m]).includes(ID), false);
  assert.equal(JSON.stringify([...store.m]).includes('accountId'), false);
  assert.deepEqual(store.m.get('answer:P-2'), { issueKey: 'P-2', answer: 'new', at: 't' });
  assert.equal((await readFeedback(store)).length, 3);
  assert.equal(await forgetAccounts(store), 0);
  // The person can still change their own verdict after the move.
  await clear(store, 'P-1');
  await saveFeedback(store, { issueKey: 'P-1', verdict: 'right', accountId: ID });
  assert.equal((await readFeedback(store)).length, 3);
  assert.equal(feedbackSummary(await readFeedback(store)).wrong, 0);
});

test('a verdict changed before the move is not overwritten by the old one', async () => {
  const store = memory();
  store.m.set(`feedback:P-1:${ID}`, { issueKey: 'P-1', decision: 'clear', applied: true, verdict: 'wrong', accountId: ID });
  await clear(store, 'P-1');
  await saveFeedback(store, { issueKey: 'P-1', verdict: 'right', accountId: ID });
  await forgetAccounts(store);
  const all = await readFeedback(store);
  assert.deepEqual(all.map((f) => f.verdict), ['right']);
});
