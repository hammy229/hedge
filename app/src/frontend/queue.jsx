import React, { useEffect, useRef, useState } from 'react';
import ForgeReconciler, {
  Box, Button, EmptyState, Heading, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Text, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { PANEL_TEXT, QUEUE_TEXT, TONE, answerChoices, answerStatus, panelFailure, panelView, queueView } from '../view.js';

const card = (tone) =>
  xcss({
    borderRadius: 'border.radius.200',
    borderWidth: 'border.width',
    borderStyle: 'solid',
    borderColor: tone ? tone.border : 'color.border',
  });

// One waiting ticket. The comparison is read only when asked for, since each one searches up
// to 1,000 earlier issues.
function Ticket({ row, onDone }) {
  const [result, setResult] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [answered, setAnswered] = useState(null);

  const compare = () => {
    setError(null);
    setComparing(true);
    invoke('compare', { issueKey: row.key })
      .then(
        (r) => (r?.error || r?.failed ? setError(r.error ?? r.reason) : setResult(r)),
        (e) => setError(panelFailure(e?.message).text),
      )
      .finally(() => setComparing(false));
  };

  const send = (payload) => {
    setError(null);
    setSending(true);
    invoke('answerQueued', { issueKey: row.key, ...payload })
      .then(
        () => {
          setAnswered(payload);
          onDone(row.key);
        },
        (e) => setError(answerStatus('failed', e?.message).error),
      )
      .finally(() => setSending(false));
  };

  const v = result ? panelView(result) : null;
  const candidates = v?.candidates ?? [];
  return (
    <Box xcss={card(answered ? null : TONE.ask)} padding="space.200">
      <Stack space="space.150">
        <Inline spread="space-between" alignBlock="center" space="space.200" shouldWrap>
          <Stack space="space.025">
            <Inline space="space.100" alignBlock="center">
              <Link href={row.href}>{row.key}</Link>
              {row.waited ? <Text size="small" color="color.text.subtlest">{row.waited}</Text> : null}
            </Inline>
            <Heading size="xsmall">{row.title}</Heading>
          </Stack>
          {answered || v ? null : (
            <Button isDisabled={comparing} onClick={compare}>{QUEUE_TEXT.compare}</Button>
          )}
        </Inline>

        {comparing ? (
          <Inline space="space.100" alignBlock="center">
            <Spinner size="small" label={QUEUE_TEXT.comparing} />
            <Text color="color.text.subtle">{QUEUE_TEXT.comparing}</Text>
          </Inline>
        ) : null}

        {v && !answered ? (
          <Stack space="space.100">
            <Text size="small" weight="semibold" color="color.text.subtle">{PANEL_TEXT.candidatesTitle}</Text>
            {candidates.length === 0 ? <Text>{QUEUE_TEXT.noCandidates}</Text> : null}
            {candidates.map((c) => (
              <Inline key={c.key} space="space.100" alignBlock="center" shouldWrap>
                <Link href={c.href}>{c.key}</Link>
                <Text>{c.title}</Text>
                {c.isMatch ? <Lozenge appearance="new">{PANEL_TEXT.match}</Lozenge> : null}
                <Text size="small" color="color.text.subtlest">{c.score}</Text>
              </Inline>
            ))}
            <Inline space="space.100" rowSpace="space.100" shouldWrap>
              {answerChoices(candidates).map((c) => (
                <Button key={c.id} isDisabled={sending} onClick={() => send(c.payload)}>{c.label}</Button>
              ))}
            </Inline>
          </Stack>
        ) : null}

        {answered ? (
          <Text color="color.text.accent.blue">{answerStatus(answered.answer, null, answered.duplicateOf ?? null).text}</Text>
        ) : null}
        {error ? <Text color="color.text.danger">{error}</Text> : null}
      </Stack>
    </Box>
  );
}

function Queue() {
  const [queue, setQueue] = useState(null);
  const [done, setDone] = useState([]);
  const [failed, setFailed] = useState(null);
  const [loading, setLoading] = useState(false);
  // Each read gets a number, so refreshed cards start fresh.
  const [read, setRead] = useState(0);
  const busy = useRef(false);

  const load = () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setFailed(null);
    invoke('waiting')
      .then(
        (q) => {
          // Jira's search can still list a ticket answered a moment ago.
          setQueue({ ...q, tickets: q.tickets.filter((t) => !done.includes(t.key)) });
          setRead((n) => n + 1);
        },
        (e) => setFailed(e?.message ?? 'Unknown error'),
      )
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
  };

  useEffect(load, []);

  const failure = failed ? (
    <SectionMessage appearance="warning" title={QUEUE_TEXT.failedTitle}>
      <Text>{failed}</Text>
    </SectionMessage>
  ) : null;

  if (!queue) {
    if (failure) {
      return (
        <Stack space="space.150">
          {failure}
          <Inline><Button onClick={load}>{QUEUE_TEXT.refresh}</Button></Inline>
        </Stack>
      );
    }
    return (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" label={QUEUE_TEXT.loading} />
        <Text color="color.text.subtle">{QUEUE_TEXT.loading}</Text>
      </Inline>
    );
  }

  const v = queueView(queue, done);
  return (
    <Stack space="space.200">
      <Inline spread="space-between" alignBlock="center" space="space.200">
        <Heading size="medium">{v.headline}</Heading>
        <Button isDisabled={loading} onClick={load}>{QUEUE_TEXT.refresh}</Button>
      </Inline>
      {failure}
      {v.empty ? (
        <EmptyState header={QUEUE_TEXT.emptyTitle} description={QUEUE_TEXT.empty} />
      ) : (
        <Stack space="space.150">
          <Text color="color.text.subtle">{QUEUE_TEXT.intro}</Text>
          {v.rows.map((r) => (
            <Ticket key={`${read}-${r.key}`} row={r} onDone={(key) => setDone((d) => [...d, key])} />
          ))}
          {v.moreNote ? <Text color="color.text.subtle">{v.moreNote}</Text> : null}
        </Stack>
      )}
    </Stack>
  );
}

ForgeReconciler.render(<Queue />);
