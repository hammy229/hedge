import api, { route } from '@forge/api';
import { decide, describePolicy } from './gate.js';
import { featurize } from './features.js';
import policy from './policy.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

// MCP tool: should an agent act on this ticket, or ask a person?
// Reads the issue as the calling user, so the tool never sees more than they can.
export async function triageIssue(payload) {
  const issueKey = String(payload?.issueKey ?? '').trim().toUpperCase();
  if (!ISSUE_KEY.test(issueKey)) {
    return { error: 'issueKey must look like PROJ-123.' };
  }
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description`);
  if (!res.ok) {
    return { error: `Jira returned ${res.status} for ${issueKey}.` };
  }
  const issue = await res.json();
  return { issueKey, summary: issue.fields?.summary ?? '', ...decide(featurize(issue), policy) };
}

// MCP tool: what guarantee does the installed policy give?
export async function explainPolicy() {
  return describePolicy(policy);
}
