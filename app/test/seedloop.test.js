import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeed } from '../src/seedloop.js';

const scripted = (statuses) => {
  let i = 0;
  return async () => statuses[Math.min(i++, statuses.length - 1)];
};
const noWait = { wait: async () => {} };

test('calls until done and reports every status', async () => {
  const seen = [];
  const out = await runSeed(scripted([{ created: 40 }, { created: 90 }, { created: 150, done: true }]), (s) => seen.push(s.created), noWait);
  assert.equal(out.done, true);
  assert.deepEqual(seen, [40, 90, 150]);
});

test('gives up after three calls without progress instead of spinning', async () => {
  let calls = 0;
  const stuck = async () => (++calls, { created: 10, done: false });
  await assert.rejects(runSeed(stuck, () => {}, noWait), /stopped making progress/);
  assert.equal(calls, 4); // one with progress, then three stalls
});

test('waits while another admin holds the lease, then says so', async () => {
  let waits = 0;
  await assert.rejects(
    runSeed(async () => ({ created: 0, busy: true }), () => {}, { wait: async () => void (waits += 1) }),
    /Another admin/,
  );
  assert.ok(waits >= 2);
});

test('a busy spell that clears goes on to finish', async () => {
  const out = await runSeed(scripted([{ created: 0, busy: true }, { created: 60 }, { created: 150, done: true }]), () => {}, noWait);
  assert.equal(out.done, true);
});
