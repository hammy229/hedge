import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { describePolicy } from './gate.js';
import { seedStatus, seedStep } from './seeder.js';
import { record } from './log.js';
import policies from './policy.js';
import { activePolicies, readBudgets } from './settings.js';
import { triage } from './triage.js';
import { PAGE_SIZE, collectWindow, windowJql } from './window.js';

// Forge storage, through the small get/set interface settings.js and log.js take.
export const store = { get: (k) => kvs.get(k), set: (k, v) => kvs.set(k, v) };

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
// REST v2 returns descriptions as wiki-markup strings, the form the training data has.
// v3 returns Atlassian Document Format, a different text distribution.
const FIELDS = ['summary', 'description', 'created', 'project'];

// Triage only says the status: its reason reaches every panel viewer, MCP agents and the
// decision log, so Jira's response body stays out of it.
async function jira(path, options) {
  const res = await api.asUser().requestJira(path, options);
  if (!res.ok) throw new Error(`Jira returned ${res.status}`);
  return res.json();
}

// The seeder, which only the admin page calls, needs the body: Jira names the field it
// rejected there. The message is cut short; the parsed body rides along as jiraBody.
async function jiraWithBody(path, options) {
  const res = await api.asUser().requestJira(path, options);
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

async function projectKeys() {
  const projects = await jira(route`/rest/api/2/project`);
  return Array.isArray(projects) ? projects.map((p) => p.key).filter(Boolean) : [];
}

// One triage, shared by the MCP tool and the issue panel: read the ticket and its window as
// the calling user, gate it at the admin's budgets, and log the decision.
export async function runTriage(rawKey, via) {
  const issueKey = String(rawKey ?? '').trim().toUpperCase();
  if (!ISSUE_KEY.test(issueKey)) return { error: 'issueKey must look like PROJ-123.' };
  const budgets = await readBudgets(store, policies);
  const result = await triageAt(issueKey, activePolicies(policies, budgets));
  await record(store, result, { budgets, via });
  return { ...result, budgets };
}

async function triageAt(issueKey, active) {
  try {
    const issue = await jira(route`/rest/api/2/issue/${issueKey}?fields=${FIELDS.join(',')}`);
    const jql = windowJql(issue.fields?.project?.id, issue);
    const fetchPage = (nextPageToken) =>
      jira(route`/rest/api/2/search/jql`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jql, fields: FIELDS, maxResults: PAGE_SIZE, nextPageToken }),
      });
    const [{ window, complete }, keys] = await Promise.all([collectWindow(fetchPage, issue), projectKeys()]);
    if (!complete) {
      return { issueKey, decision: 'ask', reason: 'Could not read the full search window, so a person decides.' };
    }
    return { issueKey, summary: issue.fields?.summary ?? '', ...triage({ issue, window, projectKeys: keys, policies: active }) };
  } catch (e) {
    return { issueKey, decision: 'ask', reason: `Hedge could not triage this ticket (${e.message}), so a person decides.` };
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
