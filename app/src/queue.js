// The tickets of one project that wait for a person: the ones Hedge labeled hedge-ask, plus
// any labeled by hand. Read as the person looking, so nobody sees a ticket they could not
// open. Oldest first, since the oldest has waited longest.

import { ASK_QUEUE_JQL } from './view.js';

export const QUEUE_PAGE = 25;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;

export function queueJql(projectKey) {
  const key = String(projectKey ?? '').trim().toUpperCase();
  if (!PROJECT_KEY.test(key)) throw new Error('The project key must look like PROJ.');
  return `project = "${key}" AND ${ASK_QUEUE_JQL} ORDER BY created ASC`;
}

// search(body) answers Jira's search. A failed search throws: an unreadable queue must
// never look like an empty one.
export async function readQueue(search, projectKey) {
  const jql = queueJql(projectKey);
  const out = await search({ jql, fields: ['summary', 'created'], maxResults: QUEUE_PAGE });
  if (!Array.isArray(out?.issues)) throw new Error('Jira did not return the queue.');
  const tickets = out.issues.map((i) => ({
    key: String(i?.key ?? ''),
    summary: String(i?.fields?.summary ?? ''),
    created: typeof i?.fields?.created === 'string' ? i.fields.created : null,
  }));
  return { projectKey: String(projectKey).trim().toUpperCase(), tickets, more: Boolean(out.nextPageToken) };
}

// A page shown in one project may only touch that project's tickets.
export function inProject(issueKey, projectKey) {
  const m = /^([A-Z][A-Z0-9_]+)-\d+$/.exec(String(issueKey ?? ''));
  return m !== null && m[1] === projectKey;
}
