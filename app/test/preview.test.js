import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay, settingsFor } from '../preview/replay.js';
import { start } from '../preview/server.js';

test('the local replay gives the same calls as the CI replay of the sample', () => {
  const r = replay(0.03);
  assert.equal(r.issues.length, 150);
  assert.deepEqual(r.counts, { link: 0, clear: 119, ask: 31 });
  assert.deepEqual(r.missed, ['DEMO-37', 'DEMO-50', 'DEMO-51']);
  const first = r.issues[0];
  assert.equal(first.key, 'DEMO-1');
  assert.equal(first.result.decision, 'ask');
  assert.equal(first.result.issueKey, 'DEMO-1');
  assert.deepEqual(first.result.budgets, { link: 0.03, clear: 0.03 });
  assert.deepEqual(r.issues[49].knownDuplicateOf, [r.issues[49].knownDuplicateOf[0]]);
});

test('an uncertified or unknown budget asks about everything or is refused', () => {
  assert.deepEqual(replay(0.02).counts, { link: 0, clear: 0, ask: 150 });
  assert.throws(() => replay(0.04), /not a budget/);
  assert.throws(() => replay('0.03'), /not a budget/);
});

test('settings list the certified budgets the admin page offers', () => {
  const s = settingsFor(0.03);
  assert.equal(s.clear.budget, 0.03);
  assert.ok(s.clear.options.some((o) => o.alpha === 0.03 && o.certified));
  assert.match(s.link.guarantee, /asks a person/);
});

test('the server serves the page, the shared view code and the API, and nothing else', async () => {
  const server = await start(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/app.js', '/style.css', '/src/view.js', '/src/act.js']) {
      assert.equal((await fetch(base + path)).status, 200, path);
    }
    const r = await (await fetch(`${base}/api/replay?budget=0.025`)).json();
    assert.equal(r.counts.clear, 114);
    assert.equal((await fetch(`${base}/api/replay?budget=9`)).status, 400);
    for (const path of ['/src/policy.js', '/../package.json', '/preview/server.js', '/%2e%2e/manifest.yml']) {
      assert.equal((await fetch(base + path)).status, 404, path);
    }
  } finally {
    server.close();
  }
});
