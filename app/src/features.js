// Turn a Jira issue into the numeric features the gate reads.
// Retrieval and routing features arrive with the trained models (docs/PLAN.md, week 3).

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
