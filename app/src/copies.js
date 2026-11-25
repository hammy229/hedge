// Copies older than the window.
//
// Calibration left out every ticket whose text copies any earlier issue
// (hedge.corpus.earlier_copies), so the certified thresholds say nothing about copies.
// triage.js finds copies inside the window. This looks at older issues too, through Jira's
// text search, and only when Hedge would otherwise act.
//
// The search only has to return a superset: copyKey decides. Any issue the search did not
// return, or a search that could not be read to the end, must not be taken for "no copy".

import { createdMs } from './window.js';
import { copyKey, retrievalText, stripAnswerText } from './text.js';

export const COPY_PAGES = 4;
export const MAX_WORDS = 8;

// Jira's English text index drops these, so a search for one may match nothing.
const STOP_WORDS = new Set(
  'a an and are as at be but by for if in into is it no not of on or such that the their then there these they this to was will with'.split(' '),
);

// Whole words of the summary that Jira's text search and copyKey read the same way. Copies
// may name different issue keys, so those are stripped, as copyKey does. Words with
// punctuation inside are left out: Jira may split them differently.
export function searchWords(summary, projectKeys = []) {
  const words = stripAnswerText(summary, projectKeys)
    .split(' ')
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
    .filter((w) => /^[a-z0-9]{2,}$/.test(w) && !STOP_WORDS.has(w));
  return [...new Set(words)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, MAX_WORDS);
}

// Every project the reader can see, since calibration compared across projects. The date
// bound is loose, as in windowJql; exact times are compared below.
export function copyJql(words, ticket) {
  const d = new Date(createdMs(ticket) + 2 * 86400000).toISOString().slice(0, 10);
  const terms = words.map((w) => `summary ~ "${w}"`).join(' AND ');
  return `${terms} AND created < "${d}" ORDER BY created ASC`;
}

// { copy: key or null, complete }. complete is false when not every match could be read.
export async function findCopy(fetchPage, issue, projectKeys = [], deadline = Infinity) {
  const text = (i) => copyKey(retrievalText(i?.fields?.summary, i?.fields?.description, projectKeys), projectKeys);
  const mine = text(issue);
  if (mine === '') return { copy: null, complete: true }; // empty texts are never copies, as in calibration
  const before = createdMs(issue);
  const words = searchWords(issue?.fields?.summary, projectKeys);
  if (words.length === 0 || !Number.isFinite(before)) return { copy: null, complete: false };
  const jql = copyJql(words, issue);
  let token;
  for (let page = 0; page < COPY_PAGES; page += 1) {
    if (Date.now() > deadline) break;
    const out = await fetchPage(jql, token);
    if (!Array.isArray(out?.issues)) break;
    const hit = out.issues.find((i) => i.key !== issue.key && createdMs(i) < before && text(i) === mine);
    if (hit) return { copy: hit.key, complete: true };
    if (!out.nextPageToken) return { copy: null, complete: true };
    token = out.nextPageToken;
  }
  return { copy: null, complete: false };
}

const stop = (action, why) => ({ decision: 'ask', reason: `${why}, so a person decides whether ${action === 'link' ? 'to link it' : 'it is new'}.` });

// A result that would act, after the copy check. Anything but "read to the end and found
// none" turns it into an ask.
export async function guardCopies(result, check) {
  if (result?.decision !== 'link' && result?.decision !== 'clear') return result;
  const action = result.decision;
  let found;
  try {
    found = await check();
  } catch {
    found = null;
  }
  if (found?.complete === true && found.copy === null) return result;
  const blocked = typeof found?.copy === 'string'
    ? stop(action, `This ticket repeats the text of ${found.copy}. Copies were left out of calibration`)
    : stop(action, 'Hedge could not check the older issues for a copy of this ticket');
  const { duplicateOf, ...rest } = result;
  return {
    ...rest,
    ...blocked,
    gates: { ...result.gates, [action]: blocked },
    clearScore: null, // no budget would clear it
    ...(typeof found?.copy === 'string' ? { copyOf: found.copy } : {}),
  };
}
