import React, { useEffect, useState } from 'react';
import ForgeReconciler, { BarChart, DynamicTable, Heading, RadioGroup, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { dialView, logRows } from '../view.js';

const HEAD = {
  cells: ['Time (UTC)', 'Issue', 'Decision', 'Score', 'Budget', 'Via'].map((content) => ({ key: content, content })),
};

const NAMES = { clear: 'Clear new tickets from duplicate review', link: 'Link duplicates automatically' };

function Dial({ action, setting, onChange }) {
  const v = dialView(setting);
  return (
    <Stack space="space.100">
      <Heading size="small">{NAMES[action]}</Heading>
      <Text>{setting.guarantee}</Text>
      {v.anyCertified ? (
        <BarChart data={v.bars} xAccessor="budget" yAccessor="coverage" title="Share of calibration tickets Hedge acts on (%)" height={220} />
      ) : (
        <SectionMessage appearance="information">No budget was certified for this action, so Hedge always asks a person.</SectionMessage>
      )}
      <RadioGroup name={`budget-${action}`} options={v.choices} value={v.selected} onChange={(e) => onChange(action, Number(e.target.value))} />
    </Stack>
  );
}

function Admin() {
  const [settings, setSettings] = useState(null);
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);

  const load = () =>
    Promise.all([invoke('settings'), invoke('log')]).then(([s, l]) => {
      setSettings(s);
      setLog(l);
    }, (e) => setError(e?.message ?? 'unknown error'));

  useEffect(() => {
    load();
  }, []);

  const change = (action, alpha) => {
    setError(null);
    invoke('setBudget', { action, alpha }).then(load, (e) => setError(e?.message ?? 'unknown error'));
  };

  if (!settings) return error ? <SectionMessage appearance="error">{error}</SectionMessage> : <Spinner label="Loading Hedge settings" />;

  return (
    <Stack space="space.300">
      <Text>
        Pick how often Hedge may be wrong when it acts. Every budget below was certified on held-out tickets with 90%
        confidence, so you can switch between them at any time. A tighter budget means Hedge acts on fewer tickets and asks
        about the rest.
      </Text>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      <Dial action="clear" setting={settings.clear} onChange={change} />
      <Dial action="link" setting={settings.link} onChange={change} />
      <Heading size="small">Recent decisions</Heading>
      <DynamicTable head={HEAD} rows={logRows(log)} rowsPerPage={10} emptyView="No decisions yet." />
    </Stack>
  );
}

ForgeReconciler.render(<Admin />);
