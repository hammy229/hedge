import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Inline, Lozenge, SectionMessage, Spinner, Stack, Strong, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { panelView } from '../view.js';

function Panel() {
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    invoke('triage').then(setResult, (e) => setFailed(e?.message ?? 'unknown error'));
  }, []);

  if (failed) {
    return <SectionMessage appearance="warning" title="Hedge could not run">{`${failed}. A person decides this ticket.`}</SectionMessage>;
  }
  if (!result) return <Spinner label="Checking for duplicates" />;

  const v = panelView(result);
  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={v.lozenge.appearance}>{v.lozenge.text}</Lozenge>
      </Inline>
      <Text><Strong>{v.headline}</Strong></Text>
      {v.reason ? <Text>{v.reason}</Text> : null}
      {v.lines.map((line) => <Text key={line}>{line}</Text>)}
      {v.candidates.length > 0 ? (
        <Stack space="space.050">
          <Heading size="xsmall">Closest earlier issues</Heading>
          {v.candidates.map((c) => <Text key={c.key}>{`${c.key}  (BM25 ${c.score})`}</Text>)}
        </Stack>
      ) : null}
    </Stack>
  );
}

ForgeReconciler.render(<Panel />);
