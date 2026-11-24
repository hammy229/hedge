import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import manifest from '@forge/manifest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ADMIN_MODULE, QUEUE_MODULE } from '../src/resolver.js';

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

// The Rovo agent and the MCP server must go through the same two actions, so the agent can
// only report the gate's call, never act around it.
test('the Rovo agent uses exactly the actions the MCP server exposes', () => {
  const { modules } = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'));
  const [agent] = modules['rovo:agent'];
  const [mcp] = modules['rovo:mcp'];
  assert.deepEqual([...agent.actions].sort(), [...mcp.tools].sort());
  assert.match(agent.prompt, /Never say you linked, cleared or changed an issue/);
});

// The resolver tells the pages apart by module key.
test('the page keys the resolver checks are the ones the manifest declares', () => {
  const { modules } = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'));
  assert.equal(modules['jira:projectPage'][0].key, QUEUE_MODULE);
  assert.equal(modules['jira:adminPage'][0].key, ADMIN_MODULE);
});
