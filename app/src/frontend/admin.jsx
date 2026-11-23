import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  BarChart, Box, Button, Code, DynamicTable, Heading, Inline, Label, Link, Lozenge, ProgressBar, RadioGroup,
  SectionMessage, Spinner, Stack, Text, Textfield, Toggle, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { runSeed } from '../seedloop.js';
import {
  TONE, ACTION_TEXT, ACT_PROJECTS_HINT, ASK_QUEUE_JQL, AUTO_ACT_TEXT, actProjectsSaved, pauseViews, resumed, CHART_NOTE, LOG_HEAD, autoActSaved, budgetSaved, dialView, logRows, seedView,
  summaryView, verdictView,
} from '../view.js';

const card = xcss({
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius',
});

const tile = xcss({ borderRadius: 'border.radius.200', minWidth: '180px' });
const hero = xcss({
  borderRadius: 'border.radius.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: TONE.clear.border,
});

const HEAD = { cells: LOG_HEAD.map((content) => ({ key: content, content })) };

const message = (e) => e?.message ?? 'Unknown error';

function Section({ title, children }) {
  return (
    <Box xcss={card} padding="space.300">
      <Stack space="space.150">
        <Heading size="small">{title}</Heading>
        {children}
      </Stack>
    </Box>
  );
}

// A saved or failed change, shown next to the control it came from.
function Status({ status }) {
  if (!status) return null;
  return (
    <SectionMessage appearance={status.ok ? 'success' : 'error'}>
      <Text>{status.text}</Text>
    </SectionMessage>
  );
}

function Summary({ view }) {
  return (
    <Stack space="space.100">
      <Inline space="space.200" shouldWrap>
        {view.tiles.map((t) => (
          <Box key={t.key} xcss={tile} backgroundColor="color.background.neutral" paddingBlock="space.150" paddingInline="space.200">
            <Stack space="space.050">
              <Text size="small" color="color.text.subtle">{t.label}</Text>
              <Heading size="medium">{t.value}</Heading>
            </Stack>
          </Box>
        ))}
      </Inline>
      {view.hint ? <Text color="color.text.subtle">{view.hint}</Text> : null}
    </Stack>
  );
}

function Dial({ action, setting, saving, status, onChange }) {
  const v = dialView(setting);
  const copy = ACTION_TEXT[action];
  return (
    <Section title={copy.title}>
      <Text>{copy.blurb}</Text>
      {v.current ? <Text weight="semibold">{v.current}</Text> : null}
      {v.anyCertified ? (
        <Stack space="space.050">
          <BarChart data={v.bars} xAccessor="budget" yAccessor="coverage" title="Share of held-out tickets Hedge acts on (%)" height={220} />
          <Text size="small" color="color.text.subtle">{CHART_NOTE}</Text>
        </Stack>
      ) : (
        <SectionMessage appearance="information">
          <Text>No budget was certified for this action, so Hedge always asks a person.</Text>
        </SectionMessage>
      )}
      <Text weight="semibold">Error budget</Text>
      <RadioGroup
        name={`budget-${action}`}
        options={v.choices}
        value={v.selected}
        isDisabled={saving}
        onChange={(e) => onChange(action, Number(e.target.value))}
      />
      <Text size="small" color="color.text.subtlest">{setting.guarantee}</Text>
      <Status status={status} />
    </Section>
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
      setError(message(e));
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
    <Section title="Sample data">
      <Text>
        {`Hedge asks about every ticket until a project has ${minWindow} earlier issues. To see it act on an empty site, add 150 real issues from Atlassian's public Jira Software Server tracker (Public Jira Dataset, CC BY 4.0) to a project you choose. Five of them are known duplicates of earlier ones.`}
      </Text>
      <Stack space="space.050">
        <Label labelFor="seed-project">Project key</Label>
        <Textfield id="seed-project" name="seed-project" placeholder="DEMO" defaultValue="" onChange={(e) => setProjectKey(e.target.value)} onBlur={lookUp} />
      </Stack>
      <Inline>
        <Button appearance="primary" isDisabled={running || v.done || projectKey.trim() === ''} onClick={run}>{v.button}</Button>
      </Inline>
      {status ? <ProgressBar value={v.progress} ariaLabel="Sample issues created" appearance={v.done ? 'success' : 'default'} /> : null}
      {v.text ? <Text>{v.text}</Text> : null}
      {error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : null}
    </Section>
  );
}

// Off by default: until an admin opts in, Hedge only answers the panel and agents.
function AutoAct({ on, saving, status, onChange, projects, onSaveProjects }) {
  const [text, setText] = useState(projects.join(', '));
  useEffect(() => setText(projects.join(', ')), [projects]);
  return (
    <Section title="Act on new issues">
      <Text>{AUTO_ACT_TEXT}</Text>
      <Inline space="space.100" alignBlock="center">
        <Text>To see what is waiting for a person, search Jira for</Text>
        <Code>{ASK_QUEUE_JQL}</Code>
      </Inline>
      <Inline space="space.100" alignBlock="center">
        <Toggle id="auto-act" isChecked={on} isDisabled={saving} onChange={() => onChange(!on)} />
        <Label labelFor="auto-act">Act on new issues</Label>
        <Lozenge appearance={on ? 'inprogress' : 'default'}>{on ? 'On' : 'Off'}</Lozenge>
      </Inline>
      <Stack space="space.050">
        <Label labelFor="act-projects">Only in these projects</Label>
        <Inline space="space.100" alignBlock="center">
          {/* Uncontrolled (a controlled Textfield drops typed characters); the key remounts it with the saved, cleaned list. */}
          <Textfield key={projects.join(',')} id="act-projects" name="act-projects" placeholder="DEMO, OPS" defaultValue={projects.join(', ')} onChange={(e) => setText(e.target.value)} />
          <Button isDisabled={saving} onClick={() => onSaveProjects(text)}>Save projects</Button>
        </Inline>
        <Text size="small" color="color.text.subtlest">{ACT_PROJECTS_HINT}</Text>
      </Stack>
      <Status status={status} />
    </Section>
  );
}

function Paused({ views, saving, onResume }) {
  return views.map((v) => (
    <SectionMessage key={v.action} appearance="warning" title={v.title}>
      <Stack space="space.100">
        <Text>{v.text}</Text>
        <Inline>
          <Button isDisabled={saving} onClick={() => onResume(v.action)}>Resume</Button>
        </Inline>
      </Stack>
    </SectionMessage>
  ));
}

function Decisions({ log }) {
  const rows = logRows(log).map((r) => ({
    key: r.key,
    cells: [
      { key: 'at', content: r.at },
      { key: 'issue', content: r.href ? <Link href={r.href}>{r.issueKey}</Link> : r.issueKey },
      { key: 'decision', content: r.decision.text ? <Lozenge appearance={r.decision.appearance}>{r.decision.text}</Lozenge> : '' },
      { key: 'score', content: r.score },
      { key: 'budget', content: r.budget },
      { key: 'via', content: r.via },
      {
        key: 'applied',
        content: r.applied.appearance ? (
          <Stack space="space.050">
            <Lozenge appearance={r.applied.appearance}>{r.applied.text}</Lozenge>
            {r.applied.why ? <Text size="small" color="color.text.subtle">{r.applied.why}</Text> : null}
          </Stack>
        ) : r.applied.text,
      },
    ],
  }));
  return (
    <Section title="Recent decisions">
      <Text size="small" color="color.text.subtle">
        Hedge's latest calls, newest first. Carried out says whether the new issue trigger applied it in Jira. Calls from the panel or an agent are reported only.
      </Text>
      <DynamicTable head={HEAD} rows={rows} rowsPerPage={10} emptyView="No decisions yet. Open an issue to see Hedge's call." />
    </Section>
  );
}

function Admin() {
  const [settings, setSettings] = useState(null);
  const [log, setLog] = useState([]);
  const [autoAct, setAutoAct] = useState(false);
  const [actProjects, setActProjects] = useState(null);
  const [pauses, setPauses] = useState(null);
  const [verdicts, setVerdicts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // Which control is saving, and the last saved or failed change: { where, ok, text }.
  const [saving, setSaving] = useState(null);
  const [status, setStatus] = useState(null);

  const load = () =>
    Promise.all([invoke('settings'), invoke('log'), invoke('autoAct'), invoke('feedbackSummary'), invoke('actProjects'), invoke('pauses')]).then(([s, l, a, f, p, paused]) => {
      setPauses(paused);
      setSettings(s);
      setLog(l);
      setAutoAct(a === true);
      setVerdicts(f);
      setActProjects(Array.isArray(p) ? p : []);
      setLoadError(p === null ? 'The saved project list could not be read, so Hedge acts in no project until it is saved again.' : null);
    }, (e) => setLoadError(message(e)));

  useEffect(() => {
    load();
  }, []);

  const change = (action, alpha) => {
    setStatus(null);
    setSaving(action);
    invoke('setBudget', { action, alpha })
      .then(
        (budgets) => {
          setStatus({ where: action, ok: true, text: budgetSaved(action, budgets, settings?.[action]) });
          return load();
        },
        (e) => setStatus({ where: action, ok: false, text: message(e) }),
      )
      .finally(() => setSaving(null));
  };

  const switchAutoAct = (on) => {
    setStatus(null);
    setSaving('autoAct');
    invoke('setAutoAct', { on })
      .then(
        (saved) => {
          setAutoAct(saved === true);
          setStatus({ where: 'autoAct', ok: true, text: autoActSaved(saved) });
        },
        (e) => setStatus({ where: 'autoAct', ok: false, text: message(e) }),
      )
      .finally(() => setSaving(null));
  };

  const saveProjects = (text) => {
    setStatus(null);
    setSaving('autoAct');
    invoke('setActProjects', { text })
      .then(
        (saved) => {
          setActProjects(saved);
          setStatus({ where: 'autoAct', ok: true, text: actProjectsSaved(saved) });
        },
        (e) => setStatus({ where: 'autoAct', ok: false, text: message(e) }),
      )
      .finally(() => setSaving(null));
  };

  const resume = (action) => {
    setStatus(null);
    setSaving('resume');
    invoke('resume', { action })
      .then(
        () => {
          setStatus({ where: 'resume', ok: true, text: resumed(action) });
          return load();
        },
        (e) => setStatus({ where: 'resume', ok: false, text: message(e) }),
      )
      .finally(() => setSaving(null));
  };

  if (!settings || !actProjects) {
    return loadError ? (
      <SectionMessage appearance="error" title="Hedge could not load its settings">
        <Text>{loadError}</Text>
      </SectionMessage>
    ) : (
      <Inline space="space.100" alignBlock="center">
        <Spinner size="small" label="Loading Hedge settings" />
        <Text color="color.text.subtle">Loading Hedge settings.</Text>
      </Inline>
    );
  }

  const at = (where) => (status?.where === where ? status : null);
  const verdict = verdictView(verdicts, settings.clear.budget);

  return (
    <Stack space="space.300">
      <Stack space="space.200">
        <Box xcss={hero} backgroundColor={TONE.clear.background} padding="space.300">
          <Stack space="space.100">
            <Heading size="medium">Hedge acts only inside the error rate you set, and asks a person about the rest.</Heading>
            <Text>
              Each certified budget below was checked on held-out tickets with 90% confidence, so you can switch between them at any time. A tighter budget means Hedge acts on fewer tickets.
            </Text>
          </Stack>
        </Box>
        <Paused views={pauseViews(pauses)} saving={saving === 'resume'} onResume={resume} />
        <Status status={at('resume')} />
        <Summary view={summaryView(settings, autoAct, log, actProjects)} />
        {loadError ? (
          <SectionMessage appearance="error">
            <Text>{loadError}</Text>
          </SectionMessage>
        ) : null}
      </Stack>
      <Dial action="clear" setting={settings.clear} saving={saving === 'clear'} status={at('clear')} onChange={change} />
      <Dial action="link" setting={settings.link} saving={saving === 'link'} status={at('link')} onChange={change} />
      <AutoAct on={autoAct} saving={saving === 'autoAct'} status={at('autoAct')} onChange={switchAutoAct} projects={actProjects} onSaveProjects={saveProjects} />
      <Section title="What people said">
        {verdict.warn ? (
          <SectionMessage appearance="warning">
            <Text>{verdict.text}</Text>
          </SectionMessage>
        ) : (
          <Text>{verdict.text}</Text>
        )}
      </Section>
      <Decisions log={log} />
      <SampleData minWindow={settings.clear.minWindow ?? 30} />
    </Stack>
  );
}

ForgeReconciler.render(<Admin />);
