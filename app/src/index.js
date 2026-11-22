import api, { route } from '@forge/api';
import { WhereConditions, kvs } from '@forge/kvs';
import { applyDecision } from './act.js';
import { onCreated } from './created.js';
import { describePolicy } from './gate.js';
import { seedStatus, seedStep, seedingNow } from './seeder.js';
import { readDecision, record } from './log.js';
import { withRetry } from './retry.js';
import policies from './policy.js';
import { activePolicies, readActProjects, readAutoAct, readBudgets } from './settings.js';
import { triage } from './triage.js';
import { PAGE_SIZE, collectWindow, windowJql } from './window.js';

// Forge storage, through the small interface settings.js, log.js and feedback.js take.
// list(prefix) reads every value under a key prefix, page by page, up to LIST_MAX.
const LIST_MAX = 5000;
export const store = {
  get: (k) => kvs.get(k),
  set: (k, v) => kvs.set(k, v),
  async list(prefix) {
    const out = [];
    let cursor;
    do {
      let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
      if (cursor) q = q.cursor(cursor);
      const page = await q.getMany();
      out.push(...(page?.results ?? []).map((r) => r.value));
      cursor = page?.nextCursor;
    } while (cursor && out.length < LIST_MAX);
    return out;
  },
};

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
// REST v2 returns descriptions as wiki-markup strings, the form the training data has.
// v3 returns Atlassian Document Format, a different text distribution.
const FIELDS = ['summary', 'description', 'created', 'project'];

// Triage only says the status: its reason reaches every panel viewer, MCP agents and the
// decision log, so Jira's response body stays out of it. The panel and MCP read as the
// calling user; an issue trigger has no user, so it reads as the app.
const send = (as, path, options, retry) => {
  const actor = as === 'app' ? api.asApp() : api.asUser();
  return withRetry(() => actor.requestJira(path, options), retry);
};

// Creating an issue twice is worse than failing once, so creates retry only on 429.
const ONLY_RATE_LIMIT = { statuses: [429] };

async function jira(path, options, as = 'user') {
  const res = await send(as, path, options);
  if (!res.ok) throw new Error(`Jira returned ${res.status}`);
  return res.json();
}

// The seeder, which only the admin page calls, needs the body: Jira names the field it
// rejected there. The message is cut short; the parsed body rides along as jiraBody.
async function jiraWithBody(path, options) {
  const res = await send('user', path, options, options?.method === 'POST' ? ONLY_RATE_LIMIT : undefined);
  if (!res.ok) throw await jiraError(res);
  return res.json();
}

export async function jiraError(res) {
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }
  const short = text.replace(/\s+/g, ' ').trim().slice(0, 200);
  const error = new Error(short ? `Jira returned ${res.status}: ${short}` : `Jira returned ${res.status}`);
  try {
    error.jiraBody = JSON.parse(text);
  } catch {
    error.jiraBody = null;
  }
  return error;
}

// Writes (labels, links) answer 204 with no body, so only the status is read.
async function jiraWrite(path, options, as) {
  const res = await send(as, path, options);
  if (!res.ok) throw new Error(`Jira returned ${res.status}`);
  return null;
}

async function projectKeys(as) {
  const projects = await jira(route`/rest/api/2/project`, undefined, as);
  return Array.isArray(projects) ? projects.map((p) => p.key).filter(Boolean) : [];
}

// One triage, shared by the MCP tool, the issue panel and the issue trigger: read the
// ticket and its window (as the calling user, or as the app for the trigger), gate it at
// the admin's budgets, and log the decision. `after`, when given, carries the decision out
// before it is logged, so the log says whether it was applied.
export async function runTriage(rawKey, via, as = 'user', after = null) {
  const issueKey = String(rawKey ?? '').trim().toUpperCase();
  if (!ISSUE_KEY.test(issueKey)) return { error: 'issueKey must look like PROJ-123.' };
  const budgets = await readBudgets(store, policies);
  const result = await triageAt(issueKey, activePolicies(policies, budgets), as);
  if (after) {
    try {
      result.applied = await after(result);
    } catch (e) {
      result.applied = { applied: false, error: String(e?.message ?? e) };
    }
  }
  await record(store, result, { budgets, via });
  return { ...result, budgets };
}

async function triageAt(issueKey, active, as) {
  try {
    const issue = await jira(route`/rest/api/2/issue/${issueKey}?fields=${[...FIELDS, 'labels'].join(',')}`, undefined, as);
    const jql = windowJql(issue.fields?.project?.id, issue);
    const fetchPage = (nextPageToken) =>
      jira(route`/rest/api/2/search/jql`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql, fields: FIELDS, maxResults: PAGE_SIZE, nextPageToken }),
      }, as);
    const [{ window, complete }, keys] = await Promise.all([collectWindow(fetchPage, issue), projectKeys(as)]);
    if (!complete) {
      return { issueKey, decision: 'ask', failed: true, reason: 'Could not read the full search window, so a person decides.' };
    }
    const labels = Array.isArray(issue.fields?.labels) ? issue.fields.labels : [];
    return { issueKey, summary: issue.fields?.summary ?? '', labels, ...triage({ issue, window, projectKeys: keys, policies: active }) };
  } catch (e) {
    // failed: the ask is about Jira, not the ticket, so the trigger leaves the issue alone.
    return { issueKey, decision: 'ask', failed: true, reason: `Hedge could not triage this ticket (${e.message}), so a person decides.` };
  }
}

// Admin page: create the next sample issues as the admin, who must be able to create
// issues in the project. Jira's own permissions decide, not Hedge.
export function seedProject(projectKey) {
  return seedStep({ jira: jiraWithBody, store, projectKey, route });
}

export function seedProgress(projectKey) {
  return seedStatus(store, projectKey);
}

// Issue trigger: triage each new issue and carry the decision out, if the admin turned
// acting on.
export function issueCreated(event) {
  return onCreated(event, {
    readAutoAct: () => readAutoAct(store),
    readActProjects: () => readActProjects(store),
    triage: runTriage,
    apply: (result) => applyDecision(result, (path, options) => jiraWrite(path, options, 'app'), route),
    alreadyHandled: async (key) => (await readDecision(store, key))?.via === 'trigger',
    seeding: (projectKey) => seedingNow(store, projectKey),
  });
}

// MCP tool: may an agent act on this ticket (link it as a duplicate, or clear it as new),
// or must it ask a person? Reads Jira as the calling user, so the tool never sees more
// than they can.
export async function triageIssue(payload) {
  return runTriage(payload?.issueKey, 'mcp');
}

// MCP tool: what guarantee does each installed policy give?
export async function explainPolicy() {
  const active = activePolicies(policies, await readBudgets(store, policies));
  return { link: describePolicy(active.link), clear: describePolicy(active.clear) };
}
