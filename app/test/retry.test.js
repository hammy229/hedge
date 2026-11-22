import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryDelay, withRetry } from '../src/retry.js';

const res = (status, retryAfter) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (h) => (h.toLowerCase() === 'retry-after' && retryAfter !== undefined ? String(retryAfter) : null) },
});

function sender(statuses) {
  const calls = [];
  return {
    calls,
    send: async () => {
      calls.push(Date.now());
      return statuses[Math.min(calls.length - 1, statuses.length - 1)];
    },
  };
}

test('a rate-limited request is sent again after the delay Jira asks for', async () => {
  const waits = [];
  const s = sender([res(429, 1), res(200)]);
  const out = await withRetry(s.send, { sleep: async (ms) => void waits.push(ms) });
  assert.equal(out.status, 200);
  assert.equal(s.calls.length, 2);
  assert.deepEqual(waits, [1000]);
});

test('without Retry-After the delay doubles from a short start', async () => {
  const waits = [];
  const s = sender([res(503), res(503), res(200)]);
  const out = await withRetry(s.send, { sleep: async (ms) => void waits.push(ms), jitter: () => 0 });
  assert.equal(out.status, 200);
  assert.deepEqual(waits, [500, 1000]);
});

test('it gives up after the last try and returns the last response', async () => {
  const s = sender([res(429)]);
  const out = await withRetry(s.send, { sleep: async () => {}, tries: 3 });
  assert.equal(out.status, 429);
  assert.equal(s.calls.length, 3);
});

test('a wait longer than the cap is not attempted, since Forge would time out first', async () => {
  const waits = [];
  const s = sender([res(429, 60), res(200)]);
  const out = await withRetry(s.send, { sleep: async (ms) => void waits.push(ms) });
  assert.equal(out.status, 429);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(waits, []);
});

test('other errors and successes are returned at once', async () => {
  for (const status of [200, 204, 400, 403, 404, 500]) {
    const s = sender([res(status)]);
    const out = await withRetry(s.send, { sleep: async () => assert.fail('no wait') });
    assert.equal(out.status, status);
    assert.equal(s.calls.length, 1);
  }
});

test('retryDelay reads seconds and ignores junk', () => {
  assert.equal(retryDelay(res(429, 2), 0), 2000);
  assert.equal(retryDelay(res(429, 'soon'), 0, () => 0), 500);
  assert.equal(retryDelay(res(429, -3), 1, () => 0), 1000);
  assert.equal(retryDelay({ status: 429 }, 0, () => 0), 500);
});

test('a caller can narrow the statuses retried, as issue creates do', async () => {
  const s = sender([res(503), res(200)]);
  const out = await withRetry(s.send, { sleep: async () => {}, statuses: [429] });
  assert.equal(out.status, 503);
  assert.equal(s.calls.length, 1);
});

test('retries share one budget of waiting, so a triage of many reads stays inside Forge\'s time limit', async () => {
  const waits = [];
  const budget = { ms: 1500 };
  const opts = { sleep: async (ms) => void waits.push(ms), budget };
  assert.equal((await withRetry(sender([res(429, 1), res(200)]).send, opts)).status, 200);
  const s = sender([res(429, 1), res(200)]);
  assert.equal((await withRetry(s.send, opts)).status, 429);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(waits, [1000]);
  assert.equal(budget.ms, 500);
});
