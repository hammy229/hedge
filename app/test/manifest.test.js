import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import manifest from '@forge/manifest';

// forge lint needs a login; the schema and reference checks it runs do not.
test('the manifest passes the Forge schema and reference checks', async () => {
  const cwd = process.cwd();
  process.chdir(dirname(dirname(fileURLToPath(import.meta.url))));
  try {
    const result = await manifest.validate(false, 'manifest.yml');
    assert.equal(result.success, true, JSON.stringify(result.errors));
  } finally {
    process.chdir(cwd);
  }
});
