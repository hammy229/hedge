// The deployed retriever, bm25-recent1000-v1: BM25 over the most recent earlier issues of
// the ticket's project, indexed on that window alone. Mirrors ml/hedge/window.py, because
// the policy's threshold is certified on exactly these scores (docs/adr/0004).

export const RETRIEVER = 'bm25-recent1000-v1';
export const WINDOW = 1000;
export const K = 10;
const K1 = 1.2;
const B = 0.75;

// Same token rule as ml/hedge/bm25.py: lowercase ASCII words, keeping dotted and
// underscored names (FileSystem.open, max_len) whole.
const TOKEN = /[a-z0-9]+(?:[._][a-z0-9]+)*/g;

export function tokenize(text) {
  return String(text ?? '').toLowerCase().match(TOKEN) ?? [];
}

function counts(tokens) {
  const m = new Map();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

// BM25 score of the query against every window document (Lucene's always-positive IDF).
export function windowScores(windowTexts, queryText) {
  const n = windowTexts.length;
  if (n === 0) return [];
  const query = counts(tokenize(queryText));
  const docs = windowTexts.map((t) => tokenize(t));
  const lengths = docs.map((d) => d.length);
  const total = lengths.reduce((a, b) => a + b, 0);
  const avg = total > 0 ? total / n : 1;
  const tf = docs.map((d) => {
    const m = new Map();
    for (const t of d) if (query.has(t)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const idf = new Map();
  for (const term of query.keys()) {
    const df = tf.reduce((c, m) => c + (m.has(term) ? 1 : 0), 0);
    idf.set(term, Math.log1p((n - df + 0.5) / (df + 0.5)));
  }
  return tf.map((m, d) => {
    const norm = K1 * (1 - B + (B * lengths[d]) / avg);
    let s = 0;
    for (const [term, f] of m) s += ((f * (K1 + 1)) / (f + norm)) * idf.get(term) * query.get(term);
    return s;
  });
}

// Positions of the k best positive scores, best first; equal scores go to the older issue
// (the lower position). A document sharing no term with the query is not a candidate.
export function topK(scores, k = K) {
  return scores
    .map((s, i) => [s, i])
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, k)
    .map(([, i]) => i);
}
