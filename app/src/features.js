// Turn a Jira issue and its retrieval scores into the numeric features the gate reads.
// Every definition here must match ml/hedge/features.py; fixtures/features.json holds the
// cases both test suites check.

export const K = 10;

// Jira Cloud returns descriptions as Atlassian Document Format: a tree of nodes whose
// leaves carry text.
export function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text ?? '';
  const children = Array.isArray(node.content) ? node.content : [];
  const sep = node.type === 'paragraph' || node.type === 'heading' ? '\n' : '';
  return children.map(adfToText).join('') + sep;
}

export function featurize(issue) {
  const summary = issue?.fields?.summary ?? '';
  const description = adfToText(issue?.fields?.description).trim();
  return {
    summaryWords: summary.split(/\s+/).filter(Boolean).length,
    hasDescription: description.length > 0 ? 1 : 0,
  };
}

// How sure the retriever looks about its best candidate: top score, gap to the second,
// and the entropy of a softmax over the top k scores divided by log(k).
export function scoreFeatures(scores, k = K) {
  if (!(k >= 2)) throw new RangeError('k must be at least 2');
  const s = [...(scores ?? [])].map(Number).sort((a, b) => b - a).slice(0, k);
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
