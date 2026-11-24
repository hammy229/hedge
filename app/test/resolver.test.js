import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_MODULE, QUEUE_MODULE, handlers } from '../src/resolver.js';
import policies from '../src/policy.js';

test('only the admin page may move the dial', async () => {
  for (const moduleKey of ['hedge-panel', undefined, 'hedge-admin ']) {
    await assert.rejects(
      handlers.setBudget({ payload: { action: 'clear', alpha: 0.05 }, context: { moduleKey } }),
      /admin page/,
    );
  }
  assert.equal(ADMIN_MODULE, 'hedge-admin');
});

test('unreachable storage keeps the default budget on the dial but closes the gate, since Hedge may be paused', async () => {
  const s = await handlers.settings();
  assert.equal(s.clear.budget, policies.clear.alpha);
  assert.ok(s.clear.options.some((o) => o.isDefault && o.certified));
  assert.match(s.clear.guarantee, /could not read whether it is paused/);
  assert.match(s.link.guarantee, /Every ticket goes to a person/);
  assert.equal(s.clear.minWindow, policies.clear.minWindow);
});

test('the panel refuses a context without an issue key', async () => {
  const out = await handlers.triage({ context: {} });
  assert.match(out.error, /PROJ-123/);
});

test('only the admin page may read the decision log', async () => {
  for (const context of [{ moduleKey: 'hedge-panel' }, {}, undefined]) {
    assert.throws(() => handlers.log({ context }), /admin page/);
  }
  assert.throws(() => handlers.log(), /admin page/);
});

test('only the admin page may add sample data', async () => {
  for (const context of [{ moduleKey: 'hedge-panel' }, {}, undefined]) {
    assert.throws(() => handlers.seed({ payload: { projectKey: 'DEMO' }, context }), /admin page/);
    assert.throws(() => handlers.seedStatus({ payload: { projectKey: 'DEMO' }, context }), /admin page/);
  }
});

test('only the admin page may switch acting on new issues', async () => {
  for (const context of [{ moduleKey: 'hedge-panel' }, {}, undefined]) {
    await assert.rejects(handlers.setAutoAct({ payload: { on: true }, context }), /admin page/);
  }
  await assert.rejects(handlers.setAutoAct(), /admin page/);
});

test('a verdict needs an issue from Jira context, and only the admin page reads the summary', async () => {
  for (const context of [{}, { extension: {} }, undefined]) {
    await assert.rejects(handlers.feedback({ payload: { verdict: 'wrong' }, context }), /from an issue/);
  }
  for (const context of [{ moduleKey: 'hedge-panel' }, {}, undefined]) {
    await assert.rejects(handlers.feedbackSummary({ context }), /admin page/);
  }
});

test('only the admin page may change which projects Hedge acts in', async () => {
  for (const context of [{ moduleKey: 'hedge-panel' }, {}, undefined]) {
    await assert.rejects(handlers.setActProjects({ payload: { text: 'DEMO' }, context }), /admin page/);
    await assert.rejects(handlers.actProjects({ context }), /admin page/);
  }
  await assert.rejects(handlers.setActProjects(), /admin page/);
});

test('only the admin page may read pauses or resume Hedge', async () => {
  for (const context of [{ moduleKey: 'hedge-panel' }, {}, undefined]) {
    await assert.rejects(handlers.pauses({ context }), /admin page/);
    await assert.rejects(handlers.resume({ payload: { action: 'clear' }, context }), /admin page/);
  }
  await assert.rejects(handlers.resume(), /admin page/);
});

test('an answer needs an issue from Jira context, and only the admin page reads the counts', async () => {
  await assert.rejects(handlers.answer({ payload: { answer: 'new' }, context: {} }), /from an issue/);
  for (const context of [{ moduleKey: 'hedge-panel' }, {}, undefined]) {
    assert.throws(() => handlers.answerSummary({ context }), /admin page/);
  }
});

test('only the admin page may count the queue', () => {
  for (const context of [{ moduleKey: 'hedge-panel' }, {}, undefined]) {
    assert.throws(() => handlers.queue({ context }), /admin page/);
  }
});

const queuePage = { moduleKey: QUEUE_MODULE, extension: { project: { key: 'DEMO' } } };

test('the queue opens only on its project page', async () => {
  for (const context of [{ ...queuePage, moduleKey: 'hedge-panel' }, { moduleKey: QUEUE_MODULE }, {}, undefined]) {
    await assert.rejects(handlers.waiting({ context }), /project page/);
    await assert.rejects(handlers.compare({ payload: { issueKey: 'DEMO-1' }, context }), /project page/);
    await assert.rejects(handlers.answerQueued({ payload: { issueKey: 'DEMO-1', answer: 'new' }, context }), /project page/);
  }
});

test('the queue page cannot name a ticket from another project', async () => {
  for (const issueKey of ['HR-1', 'DEMO2-1', 'DEMO-1/../HR-1', undefined]) {
    await assert.rejects(handlers.compare({ payload: { issueKey }, context: queuePage }), /not in this project/);
    await assert.rejects(handlers.answerQueued({ payload: { issueKey, answer: 'new' }, context: queuePage }), /not in this project/);
  }
});
