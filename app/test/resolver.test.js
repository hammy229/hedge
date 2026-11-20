import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_MODULE, handlers } from '../src/resolver.js';
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

test('settings fall back to the certified defaults when storage is unreachable', async () => {
  const s = await handlers.settings();
  assert.equal(s.clear.budget, policies.clear.alpha);
  assert.ok(s.clear.options.some((o) => o.isDefault && o.certified));
  assert.match(s.clear.guarantee, /at most 3\.0% are wrong/);
  assert.match(s.link.guarantee, /asks a person about every ticket/);
});

test('the panel refuses a context without an issue key', async () => {
  const out = await handlers.triage({ context: {} });
  assert.match(out.error, /PROJ-123/);
});
