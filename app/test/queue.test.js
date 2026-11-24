import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEUE_PAGE, inProject, queueJql, readQueue } from '../src/queue.js';

test('the queue is one project, open tickets only, oldest first', () => {
  assert.equal(queueJql(' demo '), 'project = "DEMO" AND labels = hedge-ask AND statusCategory != Done ORDER BY created ASC');
});

test('nothing but a project key gets into the JQL', () => {
  for (const bad of ['DEMO" OR project = "HR', 'DE MO', '', null, undefined, '1ABC', 'A']) {
    assert.throws(() => queueJql(bad), /PROJ/);
  }
});

test('tickets come back as plain rows, and a next page is reported', async () => {
  let body;
  const out = await readQueue(async (b) => {
    body = b;
    return { issues: [{ key: 'DEMO-9', fields: { summary: 'Crash', created: '2026-11-01T00:00:00.000+0000' } }, { key: 'DEMO-10', fields: {} }], nextPageToken: 't' };
  }, 'DEMO');
  assert.equal(body.maxResults, QUEUE_PAGE);
  assert.deepEqual(out, {
    projectKey: 'DEMO',
    tickets: [
      { key: 'DEMO-9', summary: 'Crash', created: '2026-11-01T00:00:00.000+0000' },
      { key: 'DEMO-10', summary: '', created: null },
    ],
    more: true,
  });
});

test('an unreadable queue is an error, never an empty queue', async () => {
  await assert.rejects(readQueue(async () => { throw new Error('Jira returned 503'); }, 'DEMO'), /503/);
  await assert.rejects(readQueue(async () => ({}), 'DEMO'), /did not return/);
});

test('a page only touches tickets of its own project', () => {
  assert.equal(inProject('DEMO-9', 'DEMO'), true);
  for (const key of ['DEMO2-9', 'HR-1', 'DEMO-', 'DEMO-9/..', null]) assert.equal(inProject(key, 'DEMO'), false);
  assert.equal(inProject('DEMO-9', undefined), false);
});
