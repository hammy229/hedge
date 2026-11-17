// Collect the retrieval window for a ticket: the WINDOW most recent issues of its project
// created strictly before it, oldest first. Mirrors window_bounds() in ml/hedge/window.py,
// where rows are sorted by (created, key) and the window is the last WINDOW rows before
// the ticket's creation time.

import { WINDOW } from './bm25.js';
import { MAX_DESCRIPTION, codePointPrefix } from './text.js';

export const PAGE_SIZE = 100;
export const MAX_PAGES = 30;
// Forge stops a function at 25 s. Stopping the read earlier returns an incomplete window,
// which the caller turns into "ask", instead of being killed with no answer at all.
export const DEADLINE_MS = 18000;

// Only the first MAX_DESCRIPTION code points are ever scored, so long descriptions are
// cut as issues arrive instead of holding a thousand full ones in 256 MB.
function slim(issue) {
  const d = issue.fields?.description;
  if (typeof d !== 'string') return issue;
  return { ...issue, fields: { ...issue.fields, description: codePointPrefix(d, MAX_DESCRIPTION) } };
}

export function createdMs(issue) {
  const t = Date.parse(issue?.fields?.created ?? '');
  return Number.isFinite(t) ? t : NaN;
}

const byTimeThenKey = (a, b) => a.t - b.t || (a.issue.key < b.issue.key ? -1 : a.issue.key > b.issue.key ? 1 : 0);

// fetchPage(token) returns { issues, nextPageToken }, issues newest first. Pages are read
// until WINDOW earlier issues are in hand and the oldest page item is older than the
// WINDOW-th newest, so ties at the cut are all seen and settled by key like Python.
// Returns { window, complete }: complete is false when MAX_PAGES or the deadline ran out first, so the
// caller can refuse to act on a window it could not fully read.
export async function collectWindow(fetchPage, ticket, size = WINDOW, deadline = Date.now() + DEADLINE_MS) {
  const before = createdMs(ticket);
  if (!Number.isFinite(before)) throw new Error('the ticket has no readable creation time');
  const seen = new Map();
  let token;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (Date.now() > deadline) break;
    const { issues = [], nextPageToken } = await fetchPage(token);
    let oldest = Infinity;
    for (const issue of issues) {
      const t = createdMs(issue);
      if (!Number.isFinite(t)) continue; // unknown time: neither before nor after, like Python
      oldest = Math.min(oldest, t);
      if (t < before && issue.key !== ticket.key) seen.set(issue.key, { issue: slim(issue), t });
    }
    const newestFirst = [...seen.values()].sort((a, b) => byTimeThenKey(b, a));
    const cut = newestFirst[size - 1];
    if (!nextPageToken || issues.length === 0 || (cut && oldest < cut.t)) {
      return { window: pick(newestFirst, size), complete: true };
    }
    token = nextPageToken;
  }
  return { window: pick([...seen.values()].sort((a, b) => byTimeThenKey(b, a)), size), complete: false };
}

function pick(newestFirst, size) {
  return newestFirst.slice(0, size).reverse().map((x) => x.issue);
}

// JQL dates are read in the caller's time zone, so the bound is the ticket's UTC date plus
// two days: never earlier than the ticket in any zone. Exact filtering happens above.
export function windowJql(projectId, ticket) {
  const d = new Date(createdMs(ticket) + 2 * 86400000).toISOString().slice(0, 10);
  if (!/^\d+$/.test(String(projectId))) throw new Error('project id must be numeric');
  return `project = ${projectId} AND created < "${d}" ORDER BY created DESC`;
}
