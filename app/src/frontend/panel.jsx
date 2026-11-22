import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, Heading, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Strong, Text, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { PANEL_TEXT, panelFailure, panelView, verdictStatus } from '../view.js';

const card = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius',
});

// A person's verdict on the call, which the admin page compares with the error budget.
function Verdict({ counts }) {
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const send = (verdict) => {
    setState('sending');
    setError(null);
    invoke('feedback', { verdict }).then(
      () => setState(verdict),
      (e) => {
        setError(e?.message ?? null);
        setState('failed');
      },
    );
  };
  const status = verdictStatus(state, counts, error);
  if (status.done) return <Text color="color.text.success">{status.text}</Text>;
  return (
    <Stack space="space.075">
      <Text weight="semibold">{PANEL_TEXT.verdictQuestion}</Text>
      <ButtonGroup label={PANEL_TEXT.verdictLabel}>
        <Button isDisabled={state === 'sending'} onClick={() => send('right')}>Right</Button>
        <Button isDisabled={state === 'sending'} onClick={() => send('wrong')}>Wrong</Button>
      </ButtonGroup>
      {status.error ? <Text color="color.text.danger">{status.error}</Text> : null}
    </Stack>
  );
}

function Candidates({ candidates }) {
  return (
    <Stack space="space.075">
      <Heading size="xxsmall">{PANEL_TEXT.candidatesTitle}</Heading>
      <Box xcss={card} paddingBlock="space.100" paddingInline="space.150">
        <Stack space="space.100">
          {candidates.map((c) => (
            <Inline key={c.key} spread="space-between" alignBlock="center">
              <Inline space="space.100" alignBlock="center">
                <Link href={c.href}>{c.key}</Link>
                {c.isMatch ? <Lozenge appearance="moved">{PANEL_TEXT.match}</Lozenge> : null}
              </Inline>
              <Text size="small" color="color.text.subtle">{c.score}</Text>
            </Inline>
          ))}
        </Stack>
      </Box>
      <Text size="small" color="color.text.subtlest">{PANEL_TEXT.candidatesNote}</Text>
    </Stack>
  );
}

function Panel() {
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    // Forge stops a function at 25 s; past that, say so instead of spinning forever.
    const timer = setTimeout(() => setFailed(PANEL_TEXT.timeout), 30000);
    invoke('triage')
      .then(setResult, (e) => setFailed(e?.message ?? 'Unknown error'))
      .finally(() => clearTimeout(timer));
    return () => clearTimeout(timer);
  }, []);

  if (failed) {
    const f = panelFailure(failed);
    return (
      <SectionMessage appearance="warning" title={f.title}>
        <Text>{f.text}</Text>
      </SectionMessage>
    );
  }
  if (!result) {
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" label={PANEL_TEXT.loading} />
        <Text color="color.text.subtle">{PANEL_TEXT.loading}</Text>
      </Inline>
    );
  }

  const v = panelView(result);
  if (v.kind === 'error') {
    return (
      <SectionMessage appearance="warning" title={PANEL_TEXT.failedTitle}>
        <Text>{`${v.headline} ${v.nextStep}`}</Text>
      </SectionMessage>
    );
  }

  return (
    <Stack space="space.200">
      <Stack space="space.100">
        <Inline>
          <Lozenge isBold appearance={v.lozenge.appearance}>{v.lozenge.text}</Lozenge>
        </Inline>
        <Heading size="small">{v.headline}</Heading>
        {v.carriedOut ? <Text size="small" color="color.text.subtle">{v.carriedOut}</Text> : null}
      </Stack>

      {v.budget ? (
        <Box xcss={card} padding="space.150">
          <Stack space="space.050">
            <Inline space="space.100" alignBlock="center">
              <Text size="small" weight="semibold" color="color.text.subtle">{PANEL_TEXT.budgetTitle}</Text>
              <Lozenge appearance="success">{v.budget.value}</Lozenge>
            </Inline>
            <Text size="small">{v.budget.text}</Text>
          </Stack>
        </Box>
      ) : null}

      {v.nextStep ? (
        <SectionMessage appearance="information" title={PANEL_TEXT.nextStepTitle}>
          <Text>{v.nextStep}</Text>
        </SectionMessage>
      ) : null}

      {v.reasons.length > 0 ? (
        <Stack space="space.075">
          <Heading size="xxsmall">{PANEL_TEXT.whyTitle}</Heading>
          {v.reasons.map((r) => (
            <Text key={r.text}>
              {r.label ? <Strong>{`${r.label}: `}</Strong> : null}
              {r.text}
            </Text>
          ))}
        </Stack>
      ) : null}

      {v.candidates.length > 0 ? <Candidates candidates={v.candidates} /> : null}

      {v.notes.map((n) => <Text key={n} size="small" color="color.text.subtlest">{n}</Text>)}

      <Verdict counts={v.verdictCounts} />
    </Stack>
  );
}

ForgeReconciler.render(<Panel />);
