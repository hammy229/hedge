// A person answered that a queued ticket duplicates a named earlier issue, so write the
// Duplicate link for them. It is written as that person, never as the app: they can see both
// issues or Jira refuses, so a link cannot show anyone an issue they may not read.

const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' };

export const LINK_TYPE = 'Duplicate';
export const NO_LINK =
  'Jira did not let you link these issues, or this site has no Duplicate link type. Choose another duplicate answer and link them by hand.';

// Jira reads a link as "inwardIssue duplicates outwardIssue", so the ticket is the inward
// end and the earlier issue the outward one.
export async function linkDuplicate(issueKey, original, jira, route) {
  if (!ISSUE_KEY.test(String(issueKey ?? '')) || !ISSUE_KEY.test(String(original ?? ''))) {
    return { ok: false, error: 'Both issue keys must look like PROJ-123.' };
  }
  if (issueKey === original) return { ok: false, error: 'A ticket cannot duplicate itself.' };
  try {
    await jira(route`/rest/api/2/issueLink`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ type: { name: LINK_TYPE }, inwardIssue: { key: issueKey }, outwardIssue: { key: original } }),
    });
    return { ok: true, original };
  } catch (e) {
    // Jira's own text stays out, as in act.js.
    if ([400, 401, 403, 404].includes(e?.status)) return { ok: false, error: NO_LINK };
    return { ok: false, error: Number.isInteger(e?.status) ? `Jira returned ${e.status}` : 'Jira could not be updated.' };
  }
}
