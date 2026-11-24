import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINK_TYPE, NO_LINK, linkDuplicate } from '../src/link.js';

const route = (s, ...v) => String.raw({ raw: s }, ...v);
const none = async () => [];
const refuse = (status) => async () => { throw Object.assign(new Error('secret text'), { status }); };

test('the ticket duplicates the earlier issue, not the other way round', async () => {
  let sent;
  const out = await linkDuplicate('DEMO-9', 'DEMO-2', async (path, o) => { sent = { path, method: o.method, body: JSON.parse(o.body) }; }, route, none);
  assert.deepEqual(out, { ok: true, original: 'DEMO-2' });
  assert.equal(sent.path, '/rest/api/2/issueLink');
  assert.equal(sent.method, 'POST');
  assert.deepEqual(sent.body, { type: { name: LINK_TYPE }, inwardIssue: { key: 'DEMO-9' }, outwardIssue: { key: 'DEMO-2' } });
});

test('a bad key or the ticket itself never reaches Jira', async () => {
  const never = async () => assert.fail('wrote to Jira');
  for (const other of ['DEMO-9', 'demo', '', null, 'DEMO-2/../x']) {
    assert.equal((await linkDuplicate('DEMO-9', other, never, route, none)).ok, false);
  }
  assert.equal((await linkDuplicate(undefined, 'DEMO-2', never, route, none)).ok, false);
});

test('a refusal says what to do and never repeats what Jira said', async () => {
  for (const status of [400, 401, 403, 404]) {
    assert.deepEqual(await linkDuplicate('DEMO-9', 'DEMO-2', refuse(status), route, none), { ok: false, error: NO_LINK });
  }
  assert.equal((await linkDuplicate('DEMO-9', 'DEMO-2', refuse(500), route, none)).error, 'Jira returned 500');
  assert.equal((await linkDuplicate('DEMO-9', 'DEMO-2', async () => { throw new Error('secret text'); }, route, none)).error, 'Jira could not be updated.');
});

test('a pair that is already linked, either way round, is not linked again', async () => {
  const never = async () => assert.fail('wrote to Jira');
  for (const end of ['inwardIssue', 'outwardIssue']) {
    const links = async () => [{ type: { name: LINK_TYPE }, [end]: { key: 'DEMO-2' } }];
    assert.deepEqual(await linkDuplicate('DEMO-9', 'DEMO-2', never, route, links), { ok: true, original: 'DEMO-2' });
  }
});

test('another kind of link between the two does not count', async () => {
  let posted = false;
  await linkDuplicate('DEMO-9', 'DEMO-2', async () => { posted = true; }, route, async () => [{ type: { name: 'Blocks' }, outwardIssue: { key: 'DEMO-2' } }]);
  assert.equal(posted, true);
});
