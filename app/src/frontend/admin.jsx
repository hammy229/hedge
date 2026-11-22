import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  BarChart, Button, DynamicTable, Heading, Label, ProgressBar, Toggle, RadioGroup, SectionMessage, Spinner, Stack, Text, Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { runSeed } from '../seedloop.js';
import { dialView, logRows, seedView, verdictView } from '../view.js';

const HEAD = {
  cells: ['Time (UTC)', 'Issue', 'Decision', 'Score', 'Budget', 'Via', 'Applied'].map((content) => ({ key: content, content })),
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

// Hedge asks about every ticket in a project with fewer than 30 earlier issues, so an
// empty site needs history before it can act. Each seed call stops before Forge's time
// limit; keep calling until the project has every sample issue.
function SampleData({ minWindow }) {
  const [projectKey, setProjectKey] = useState('');
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setError(null);
    setRunning(true);
    try {
      await runSeed(() => invoke('seed', { projectKey }), setStatus);
    } catch (e) {
      setError(e?.message ?? 'unknown error');
    } finally {
      setRunning(false);
    }
  };

  // Show saved progress for the typed key, so a reload mid-seed offers Continue.
  const lookUp = () => {
    if (projectKey.trim() === '') return;
    invoke('seedStatus', { projectKey }).then(setStatus, () => setStatus(null));
  };

  const v = seedView(status, running);
  return (
    <Stack space="space.100">
      <Heading size="small">Sample data</Heading>
      <Text>
        {`Hedge asks about every ticket until a project has ${minWindow} earlier issues. To see it act on an empty site, add 150 real issues from Atlassian's public Jira Software Server tracker (Public Jira Dataset, CC BY 4.0) to a project you choose. Five of them are known duplicates of earlier ones.`}
      </Text>
      <Label labelFor="seed-project">Project key</Label>
      <Textfield id="seed-project" name="seed-project" placeholder="DEMO" value={projectKey} onChange={(e) => setProjectKey(e.target.value)} onBlur={lookUp} />
      <Button appearance="primary" isDisabled={running || v.done || projectKey.trim() === ''} onClick={run}>{v.button}</Button>
      {status ? <ProgressBar value={v.progress} ariaLabel="Sample issues created" /> : null}
      {v.text ? <Text>{v.text}</Text> : null}
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
    </Stack>
  );
}

// Off by default: until an admin opts in, Hedge only answers the panel and agents.
function AutoAct({ on, onChange }) {
  return (
    <Stack space="space.100">
      <Heading size="small">Act on new issues</Heading>
      <Text>
        When this is on, Hedge triages every new issue as it is filed and carries the decision out: it labels cleared
        issues hedge-cleared, links certified duplicates, and labels the rest hedge-ask. Search labels = hedge-ask to see
        what is waiting for a person.
      </Text>
      <Label labelFor="auto-act">Act on new issues</Label>
      <Toggle id="auto-act" isChecked={on} onChange={() => onChange(!on)} />
    </Stack>
  );
}

function Admin() {
  const [settings, setSettings] = useState(null);
  const [log, setLog] = useState([]);
  const [autoAct, setAutoAct] = useState(false);
  const [verdicts, setVerdicts] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    Promise.all([invoke('settings'), invoke('log'), invoke('autoAct'), invoke('feedbackSummary')]).then(([s, l, a, f]) => {
      setSettings(s);
      setLog(l);
      setAutoAct(a === true);
      setVerdicts(f);
    }, (e) => setError(e?.message ?? 'unknown error'));

  useEffect(() => {
    load();
  }, []);

  const change = (action, alpha) => {
    setError(null);
    invoke('setBudget', { action, alpha }).then(load, (e) => setError(e?.message ?? 'unknown error'));
  };

  const switchAutoAct = (on) => {
    setError(null);
    invoke('setAutoAct', { on }).then(setAutoAct, (e) => setError(e?.message ?? 'unknown error'));
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
      <AutoAct on={autoAct} onChange={switchAutoAct} />
      <SampleData minWindow={settings.clear.minWindow ?? 30} />
      <Heading size="small">What people said</Heading>
      {(() => {
        const v = verdictView(verdicts, settings.clear.budget);
        return v.warn ? <SectionMessage appearance="warning">{v.text}</SectionMessage> : <Text>{v.text}</Text>;
      })()}
      <Heading size="small">Recent decisions</Heading>
      <DynamicTable head={HEAD} rows={logRows(log)} rowsPerPage={10} emptyView="No decisions yet." />
    </Stack>
  );
}

ForgeReconciler.render(<Admin />);
