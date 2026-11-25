import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_PAGES, MAX_WORDS, copyJql, findCopy, guardCopies, searchWords } from '../src/copies.js';

const issue = (key, summary, created, description = '') => ({ key, fields: { summary, description, created } });
const T = (day) => `2024-01-${String(day).padStart(2, '0')}T00:00:00.000+0000`;
const ticket = issue('P-9', 'Login page crashes', T(9), 'Press submit.');
const one = (...issues) => async () => ({ issues });

test('an older issue with the same text is a copy, whatever its case, punctuation or keys', async () => {
  const out = await findCopy(one(issue('P-1', 'login PAGE crashes!', T(1), 'press submit')), ticket);
  assert.deepEqual(out, { copy: 'P-1', complete: true });
  const keyed = issue('P-9', 'OPS-4 login page crashes', T(9), 'Press submit.');
  assert.equal((await findCopy(one(issue('Q-1', 'OPS-7 login page crashes', T(1), 'press submit')), keyed)).copy, 'Q-1');
});

test('the same words in a different text, a later issue, or the ticket itself are not copies', async () => {
  const out = await findCopy(
    one(issue('P-1', 'Login page crashes', T(1), 'On Firefox.'), issue('P-20', 'Login page crashes', T(20), 'Press submit.'), ticket, issue('P-3', 'Login page crashes', T(9), 'Press submit.')),
    ticket,
  );
  assert.deepEqual(out, { copy: null, complete: true });
});

test('every page is read, and a search too long to read is incomplete', async () => {
  let calls = 0;
  const last = await findCopy(async (jql, token) => {
    calls += 1;
    return token ? { issues: [issue('P-1', 'Login page crashes', T(1), 'Press submit.')] } : { issues: [], nextPageToken: 'b' };
  }, ticket);
  assert.equal(last.copy, 'P-1');
  assert.equal(calls, 2);
  calls = 0;
  const endless = await findCopy(async () => { calls += 1; return { issues: [], nextPageToken: 'x' }; }, ticket);
  assert.deepEqual(endless, { copy: null, complete: false });
  assert.equal(calls, COPY_PAGES);
});

test('a passed deadline or an unreadable page is incomplete, not "no copy"', async () => {
  assert.equal((await findCopy(one(), ticket, [], Date.now() - 1)).complete, false);
  assert.equal((await findCopy(async () => ({}), ticket)).complete, false);
});

test('an empty text is never a copy, and a text with no searchable word cannot be checked', async () => {
  const never = async () => assert.fail('no search is needed');
  assert.deepEqual(await findCopy(never, issue('P-9', '...', T(9))), { copy: null, complete: true });
  assert.deepEqual(await findCopy(never, issue('P-9', 'a-b', T(9))), { copy: null, complete: false });
});

test('the query holds only plain lowercase words, so a summary cannot change it', () => {
  const words = searchWords('Crash" OR project = SECRET \\ AND can\'t load OPS-12 (NullPointerException) naïve');
  for (const w of words) assert.match(w, /^[a-z0-9]{2,}$/);
  assert.equal(words.includes('nullpointerexception'), true);
  assert.equal(words.includes('12'), false);
  assert.deepEqual(searchWords('This is not the crash'), ['crash']); // Jira's index drops stop words
  const jql = copyJql(words, ticket);
  assert.match(jql, /^(summary ~ "[a-z0-9]+" AND )+created < "2024-01-11" ORDER BY created ASC$/);
  assert.equal(searchWords('one two three four five six seven eight nine ten').length, MAX_WORDS);
});

const acting = { issueKey: 'P-9', decision: 'clear', reason: 'ok', gates: { link: { decision: 'ask' }, clear: { decision: 'act', score: 0.99 } } };

test('a copy, an incomplete search or a failed one turns an action into an ask', async () => {
  const copy = await guardCopies(acting, async () => ({ copy: 'P-1', complete: true }));
  assert.equal(copy.decision, 'ask');
  assert.equal(copy.copyOf, 'P-1');
  assert.match(copy.reason, /repeats the text of P-1/);
  assert.equal(copy.gates.clear.score, undefined);
  for (const check of [async () => ({ copy: null, complete: false }), async () => { throw new Error('Jira returned 500'); }, async () => undefined]) {
    const out = await guardCopies(acting, check);
    assert.equal(out.decision, 'ask');
    assert.match(out.reason, /could not check the older issues/);
  }
  const link = await guardCopies({ ...acting, decision: 'link', duplicateOf: 'P-2' }, async () => ({ copy: 'P-1', complete: true }));
  assert.equal('duplicateOf' in link, false);
});

test('a ticket with no copy keeps its call, and an ask is never searched', async () => {
  assert.equal(await guardCopies(acting, async () => ({ copy: null, complete: true })), acting);
  const ask = { decision: 'ask' };
  assert.equal(await guardCopies(ask, async () => assert.fail('searched')), ask);
});
