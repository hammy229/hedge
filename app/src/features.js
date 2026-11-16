// Turn a Jira issue and its retrieval scores into the numeric features the gate reads.
// Every definition here must match ml/hedge/features.py; fixtures/features.json holds the
// cases both test suites check.

export const K = 10;

// The feature definitions and the retriever this build computes scores with. A policy
// carries the values it was trained under; the gate refuses to act on a mismatch.
export const FEATURE_SCHEMA = 1;
export const RETRIEVER = 'bm25-v1';

// Jira Cloud returns descriptions as Atlassian Document Format: a tree of nodes whose
// leaves carry text.
export function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text ?? '';
  const children = Array.isArray(node.content) ? node.content : [];
  const sep = node.type === 'paragraph' || node.type === 'heading' ? '\n' : '';
  return children.map(adfToText).join('') + sep;
}

// Python's str.isspace() set, so split and strip agree with ml/. JavaScript's \s differs:
// it adds U+FEFF and leaves out U+001C to U+001F and U+0085.
const SPACE = /[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
const words = (text) => text.split(SPACE).filter(Boolean);

function descriptionText(description) {
  // API v3 returns ADF; v2 and the dataset return a plain string.
  return typeof description === 'string' ? description : adfToText(description);
}

export function featurize(issue) {
  const summary = issue?.fields?.summary;
  return {
    summaryWords: typeof summary === 'string' ? words(summary).length : 0,
    hasDescription: words(descriptionText(issue?.fields?.description)).length > 0 ? 1 : 0,
  };
}

// How sure the retriever looks about its best candidate: top score, gap to the second,
// and the entropy of a softmax over the top k scores divided by log(k).
export function scoreFeatures(scores, k = K) {
  if (!Number.isInteger(k) || k < 2) throw new RangeError('k must be an integer of at least 2');
  const raw = Array.isArray(scores) ? scores : [];
  if (!raw.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    // Same rule as Python: a broken score gives NaN features, and the gate asks.
    return { top1: NaN, margin: NaN, entropy: NaN };
  }
  const s = [...raw].sort((a, b) => b - a).slice(0, k);
  if (s.length === 0) return { top1: 0, margin: 0, entropy: 1 };
  const margin = s.length > 1 ? s[0] - s[1] : 0;
  if (s.length === 1) return { top1: s[0], margin, entropy: 0 };
  const e = s.map((x) => Math.exp(x - s[0]));
  const total = e.reduce((a, b) => a + b, 0);
  let h = 0;
  for (const x of e) {
    const p = x / total;
    h -= p * Math.log(Math.max(p, 1e-300));
  }
  return { top1: s[0], margin, entropy: h / Math.log(k) };
}

export function gateFeatures(issue, scores) {
  return { ...scoreFeatures(scores), ...featurize(issue) };
}
