import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINK_TYPE, NO_LINK, linkDuplicate } from '../src/link.js';

const route = (s, ...v) => String.raw({ raw: s }, ...v);
const refuse = (status) => async () => { throw Object.assign(new Error('secret text'), { status }); };

test('the ticket duplicates the earlier issue, not the other way round', async () => {
  let sent;
  const out = await linkDuplicate('DEMO-9', 'DEMO-2', async (path, o) => { sent = { path, method: o.method, body: JSON.parse(o.body) }; }, route);
  assert.deepEqual(out, { ok: true, original: 'DEMO-2' });
  assert.equal(sent.path, '/rest/api/2/issueLink');
  assert.equal(sent.method, 'POST');
  assert.deepEqual(sent.body, { type: { name: LINK_TYPE }, inwardIssue: { key: 'DEMO-9' }, outwardIssue: { key: 'DEMO-2' } });
});

test('a bad key or the ticket itself never reaches Jira', async () => {
  const never = async () => assert.fail('wrote to Jira');
  for (const other of ['DEMO-9', 'demo', '', null, 'DEMO-2/../x']) {
    assert.equal((await linkDuplicate('DEMO-9', other, never, route)).ok, false);
  }
  assert.equal((await linkDuplicate(undefined, 'DEMO-2', never, route)).ok, false);
});

test('a refusal says what to do and never repeats what Jira said', async () => {
  for (const status of [400, 401, 403, 404]) {
    assert.deepEqual(await linkDuplicate('DEMO-9', 'DEMO-2', refuse(status), route), { ok: false, error: NO_LINK });
  }
  assert.equal((await linkDuplicate('DEMO-9', 'DEMO-2', refuse(500), route)).error, 'Jira returned 500');
  assert.equal((await linkDuplicate('DEMO-9', 'DEMO-2', async () => { throw new Error('secret text'); }, route)).error, 'Jira could not be updated.');
});
