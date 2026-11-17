// Issue text exactly as the retriever sees it. Mirrors retrieval_parts() and
// strip_answer_text() in ml/hedge/corpus.py and ml/hedge/leakage.py. fixtures/bm25.json
// holds the cases both sides check.
//
// JavaScript regexes differ from Python's in ways that matter here, so each is spelled out.
// Python's \b and \d are Unicode-aware (é is a word character, ١ is a digit), while
// JavaScript's are ASCII-only. Python's \s is the str.isspace() set. Lookarounds over
// \p{L}\p{N}_ stand in for \b.

export const MAX_DESCRIPTION = 1000;

const WS = '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const W = '[\\p{L}\\p{N}_]';
const START = `(?<!${W})`; // \b before a word character
const END = `(?!${W})`; // \b after one
const DIGITS = '\\p{Nd}+';

// Standards and algorithms that look like issue keys (UTF-8, SHA-256). Same list as Python.
const NOT_ISSUE_KEYS = (
  'UTF UCS ISO IEC SHA CRC AES RSA HMAC RFC CVE CWE JSR JEP PEP IPV TLS SSL HTTP ' +
  'X86 LATIN WINDOWS CP EBCDIC ECMA ES H264 MP4'
)
  .split(' ')
  .sort((a, b) => b.length - a.length);
const NOT_KEY = `(?!(?:${NOT_ISSUE_KEYS.join('|')})-\\p{Nd})`;
const ISSUE_KEY_BODY = `${NOT_KEY}[A-Z][A-Z0-9_]{1,19}-${DIGITS}`;

const ISSUE_KEY = new RegExp(`${START}${ISSUE_KEY_BODY}${END}`, 'gu');
const ISSUE_KEY_WHOLE = new RegExp(`^${ISSUE_KEY_BODY}$`, 'u');
const KEY_SHAPED = new RegExp(`${START}[A-Za-z][A-Za-z0-9_]*-${DIGITS}${END}`, 'gu');
const ISSUE_URL = new RegExp(`https?://[^${WS}]+/(?:browse|jira/browse|issues)/[^${WS}]+`, 'giu');
const DUPLICATE_PHRASE = new RegExp(
  `${START}(?:(?:is[${WS}]+)?(?:a[${WS}]+)?dup(?:e|licate)?s?(?:d)?[${WS}]+(?:of|by)|` +
    `closing[${WS}]+as[${WS}]+(?:a[${WS}]+)?dup(?:e|licate)?)${END}`,
  'giu',
);
const SPACE_RUN = new RegExp(`[${WS}]+`, 'gu');

function stripKeys(text, known) {
  if (known.size === 0) return text.replace(ISSUE_KEY, ' ');
  return text.replace(KEY_SHAPED, (token) => {
    const prefix = token.slice(0, token.lastIndexOf('-')).toUpperCase();
    return ISSUE_KEY_WHOLE.test(token) || known.has(prefix) ? ' ' : token;
  });
}

// Remove issue URLs, issue keys and "duplicate of" phrasing, then tidy whitespace.
// projectKeys are the site's project keys, so lowercase "hadoop-12" is caught too.
export function stripAnswerText(text, projectKeys = []) {
  const known = new Set([...projectKeys].map((k) => String(k).toUpperCase()));
  let t = String(text ?? '').replace(ISSUE_URL, ' ');
  t = stripKeys(t, known);
  t = t.replace(DUPLICATE_PHRASE, ' ');
  return t.replace(SPACE_RUN, ' ').replace(/^ | $/g, '');
}

// Python slices strings by code point. String.prototype.slice counts UTF-16 units, which
// would cut an emoji-heavy description at half the length.
export function codePointPrefix(text, n) {
  let out = '';
  let count = 0;
  for (const ch of text) {
    if (count === n) break;
    out += ch;
    count += 1;
  }
  return out;
}

export function retrievalText(summary, description, projectKeys = []) {
  const s = stripAnswerText(summary ?? '', projectKeys);
  const d = stripAnswerText(codePointPrefix(String(description ?? ''), MAX_DESCRIPTION), projectKeys);
  return `${s}\n${d}`;
}
