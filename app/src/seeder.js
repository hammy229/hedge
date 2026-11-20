// Sample data for an empty site: create the shipped issues (src/seed.js) in one project,
// in order, as the admin who asked.
//
// Hedge asks about every ticket in a project with fewer than the policy's minimum window
// of earlier issues (ADR 8), so a judge's empty site would only ever show "Needs a
// person". Creating the issues one at a time, oldest first, gives them the same order
// the replay test in test/seed.test.js uses. Forge stops a function at 25 s, so each call
// creates what fits before a deadline and stores where it stopped; the admin page calls
// again until it is done.

import seed from './seed.js';

export const LABEL = 'hedge-sample';
export const DEADLINE_MS = 18000;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const PREFERRED_TYPES = ['Bug', 'Task', 'Story'];
const stateKey = (projectKey) => `seed:${projectKey}`;
// Forge's requestJira takes paths built with @forge/api's route tag; tests use plain strings.
const plain = (strings, ...values) => String.raw({ raw: strings }, ...values.map(encodeURIComponent));

// The issue type to create: a Bug if the project has one, then Task, then Story, then any
// standard (non-subtask) type.
export function pickIssueType(issueTypes) {
  const standard = (Array.isArray(issueTypes) ? issueTypes : []).filter((t) => t && !t.subtask && t.id);
  for (const name of PREFERRED_TYPES) {
    const hit = standard.find((t) => t.name === name);
    if (hit) return hit;
  }
  return standard[0] ?? null;
}

export function issueFields(item, projectId, issueTypeId, withLabel = true) {
  const fields = {
    project: { id: String(projectId) },
    issuetype: { id: String(issueTypeId) },
    summary: item.summary,
    description: item.description,
  };
  if (withLabel) fields.labels = [LABEL];
  return fields;
}

// What the admin page shows about one project's seeding.
export async function seedStatus(store, projectKey) {
  const key = checkKey(projectKey);
  const state = (await store.get(stateKey(key))) ?? { next: 0 };
  return { projectKey: key, created: state.next, total: seed.issues.length, done: state.next >= seed.issues.length };
}

// Create the next issues of the seed in projectKey until done or past the deadline.
// jira(path, options) returns parsed JSON or throws on an error status; route builds paths.
export async function seedStep({ jira, store, projectKey, route = plain, deadline = Date.now() + DEADLINE_MS, items = seed.issues }) {
  const key = checkKey(projectKey);
  const state = (await store.get(stateKey(key))) ?? { next: 0, withLabel: true };
  if (state.next >= items.length) return { projectKey: key, created: state.next, total: items.length, done: true };
  const project = await jira(route`/rest/api/2/project/${key}`);
  const type = pickIssueType(project?.issueTypes);
  if (!project?.id || !type) throw new Error(`Project ${key} has no issue type Hedge can create.`);
  let withLabel = state.withLabel !== false;
  let next = state.next;
  while (next < items.length && Date.now() < deadline) {
    const body = (label) => ({
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: issueFields(items[next], project.id, type.id, label) }),
    });
    try {
      await jira(route`/rest/api/2/issue`, body(withLabel));
    } catch (e) {
      // Some project screens have no Labels field; the label is only a convenience.
      if (!withLabel || !/labels/i.test(e.message)) throw e;
      withLabel = false;
      await jira(route`/rest/api/2/issue`, body(false));
    }
    next += 1;
    await store.set(stateKey(key), { next, withLabel });
  }
  return { projectKey: key, created: next, total: items.length, done: next >= items.length };
}

function checkKey(projectKey) {
  const key = String(projectKey ?? '').trim().toUpperCase();
  if (!PROJECT_KEY.test(key)) throw new Error('Enter a project key such as DEMO.');
  return key;
}
