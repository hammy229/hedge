import assert from 'node:assert/strict';
import test from 'node:test';
import { listAll } from '../src/listing.js';

// A stand-in for kvs.query(): pages of `size` values, a cursor while more are left.
function pages(values, size = 100) {
  return (prefix) => ({
    async page(cursor) {
      const start = cursor ? Number(cursor) : 0;
      const hits = values.filter((v) => v.k.startsWith(prefix));
      const end = Math.min(start + size, hits.length);
      return { results: hits.slice(start, end).map((v) => ({ key: v.k, value: v })), nextCursor: end < hits.length ? String(end) : undefined };
    },
  });
}

const many = (n) => Array.from({ length: n }, (_, i) => ({ k: `fb:${i}` }));

test('every page under the prefix is read', async () => {
  const got = await listAll(pages([...many(250), { k: 'other' }]), 'fb:', 5000);
  assert.equal(got.length, 250);
  assert.equal(got.truncated, false);
});

test('a list cut at the cap says so', async () => {
  const got = await listAll(pages(many(320)), 'fb:', 200);
  assert.equal(got.length, 200);
  assert.equal(got.truncated, true);
});

test('a list that ends exactly at the cap is whole', async () => {
  const got = await listAll(pages(many(200)), 'fb:', 200);
  assert.equal(got.truncated, false);
});

test('an empty page with no cursor ends the list', async () => {
  const got = await listAll(() => ({ page: async () => ({}) }), 'fb:', 10);
  assert.deepEqual([...got], []);
  assert.equal(got.truncated, false);
});
