import api, { route } from '@forge/api';
import { describePolicy } from './gate.js';
import policies from './policy.js';
import { triage } from './triage.js';
import { PAGE_SIZE, collectWindow, windowJql } from './window.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
// REST v2 returns descriptions as wiki-markup strings, the form the training data has.
// v3 returns Atlassian Document Format, a different text distribution.
const FIELDS = ['summary', 'description', 'created', 'project'];

async function jira(path, options) {
  const res = await api.asUser().requestJira(path, options);
  if (!res.ok) throw new Error(`Jira returned ${res.status}`);
  return res.json();
}

async function projectKeys() {
  const projects = await jira(route`/rest/api/2/project`);
  return Array.isArray(projects) ? projects.map((p) => p.key).filter(Boolean) : [];
}

// MCP tool: may an agent act on this ticket (link it as a duplicate, or clear it as new),
// or must it ask a person? Reads Jira as the calling user, so the tool never sees more
// than they can.
export async function triageIssue(payload) {
  const issueKey = String(payload?.issueKey ?? '').trim().toUpperCase();
  if (!ISSUE_KEY.test(issueKey)) return { error: 'issueKey must look like PROJ-123.' };
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
    return { issueKey, summary: issue.fields?.summary ?? '', ...triage({ issue, window, projectKeys: keys, policies }) };
  } catch (e) {
    return { issueKey, decision: 'ask', reason: `Hedge could not triage this ticket (${e.message}), so a person decides.` };
  }
}

// MCP tool: what guarantee does each installed policy give?
export async function explainPolicy() {
  return { link: describePolicy(policies.link), clear: describePolicy(policies.clear) };
}
