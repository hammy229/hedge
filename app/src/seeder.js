// Sample data for an empty site: create the shipped issues (src/seed.js) in one project,
// in order, as the admin who asked.
//
// Hedge asks about every ticket in a project with fewer than the policy's minimum window
// of earlier issues (ADR 8), so a judge's empty site would only ever show "Needs a
// person". Creating the issues one at a time, oldest first, gives them the same order
// the replay test in test/seed.test.js uses. Forge stops a function at 25 s, so each call
// creates what fits before a deadline and stores where it stopped; the admin page calls
// again until it is done.
//
// Two admins seeding one project at once would interleave and repeat issues, so a call
// holds a short lease and a second caller gets { busy: true }. A crash between a create
// and its progress write can still repeat one issue; that costs one extra ticket, not a
// broken run.

import { SAMPLE_LABEL } from './act.js';
import seed from './seed.js';

export const LABEL = SAMPLE_LABEL;
// Leaves room for one slow create to finish before Forge's 25 s limit.
export const DEADLINE_MS = 12000;
export const LEASE_MS = 30000;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{1,19}$/;
const PREFERRED_TYPES = ['Bug', 'Task', 'Story'];
const stateKey = (projectKey) => `seed:${projectKey}`;
const leaseKey = (projectKey) => `seed-lease:${projectKey}`;
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

// Jira names the fields it rejected in errors: { labels: "..." }.
export function rejectsLabels(error) {
  return Boolean(error?.jiraBody && typeof error.jiraBody === 'object' && error.jiraBody.errors?.labels);
}

// True while a seeding call holds the project's lease, so the issue trigger can stay out
// of the way of 150 creates in a row.
export async function seedingNow(store, projectKey, now = Date.now()) {
  try {
    const lease = await store.get(leaseKey(projectKey));
    const until = typeof lease === 'number' ? lease : lease?.until;
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

// What the admin page shows about one project's seeding.
export async function seedStatus(store, projectKey, total = seed.issues.length) {
  const key = checkKey(projectKey);
  const state = (await store.get(stateKey(key))) ?? { next: 0 };
  return { projectKey: key, created: state.next, total, done: state.next >= total };
}

// Create the next issues of the seed in projectKey until done or past the deadline.
// jira(path, options) returns parsed JSON or throws an Error carrying jiraBody.
export async function seedStep({
  jira, store, projectKey, route = plain, deadline = Date.now() + DEADLINE_MS, items = seed.issues, owner = randomOwner(),
}) {
  const key = checkKey(projectKey);
  const project = await jira(route`/rest/api/2/project/${key}`);
  const type = pickIssueType(project?.issueTypes);
  if (!project?.id || !type) throw new Error(`Project ${key} has no issue type Hedge can create.`);
  let state = (await store.get(stateKey(key))) ?? null;
  // Progress belongs to one project: a project deleted and created again under the same
  // key starts over.
  if (!state || state.projectId !== String(project.id)) state = { projectId: String(project.id), next: 0, withLabel: true };
  const status = (extra = {}) => ({ projectKey: key, created: state.next, total: items.length, done: state.next >= items.length, ...extra });
  if (state.next >= items.length) return status();
  if (!(await takeLease(store, key, owner))) return status({ busy: true });
  try {
    while (state.next < items.length && Date.now() < deadline) {
      const create = () =>
        jira(route`/rest/api/2/issue`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: issueFields(items[state.next], project.id, type.id, state.withLabel !== false) }),
        });
      try {
        await create();
      } catch (e) {
        // Some project screens have no Labels field; the label is only a convenience.
        if (state.withLabel === false || !rejectsLabels(e)) throw e;
        state = { ...state, withLabel: false };
        await store.set(stateKey(key), state);
        await create();
      }
      // Never move progress backwards, even if another writer slipped past the lease.
      const saved = (await store.get(stateKey(key))) ?? {};
      const next = Math.max(state.next + 1, saved.projectId === state.projectId ? saved.next ?? 0 : 0);
      state = { ...state, next };
      await store.set(stateKey(key), state);
    }
  } finally {
    // Forge storage rejects null values, so the lease is released by expiring it.
    await store.set(leaseKey(key), { owner: null, until: 0 });
  }
  return status();
}

async function takeLease(store, key, owner) {
  const now = Date.now();
  const held = await store.get(leaseKey(key));
  if (held && held.owner !== owner && held.until > now) return false;
  await store.set(leaseKey(key), { owner, until: now + LEASE_MS });
  // Read back: of two callers that both saw it free, only the last writer goes on.
  return (await store.get(leaseKey(key)))?.owner === owner;
}

function randomOwner() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function checkKey(projectKey) {
  const key = String(projectKey ?? '').trim().toUpperCase();
  if (!PROJECT_KEY.test(key)) throw new Error('Enter a project key such as DEMO.');
  return key;
}
