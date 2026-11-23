// Static build of the local preview for any file host (`npm run preview:build`): the page,
// the shared view code and the replay at every budget, written to preview/dist.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { budgetIndex, replay, settingsFor } from './replay.js';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = at('./dist/');

await rm(out, { recursive: true, force: true });
await mkdir(`${out}data`, { recursive: true });
await mkdir(`${out}src`, { recursive: true });
for (const f of ['index.html', 'app.js', 'style.css']) await cp(at(`./${f}`), `${out}${f}`);
for (const f of ['view.js', 'act.js', 'evidence.js']) await cp(at(`../src/${f}`), `${out}src/${f}`);

const index = budgetIndex();
await writeFile(`${out}data/index.json`, JSON.stringify(index));
for (const b of index.budgets) {
  await writeFile(`${out}data/replay-${b}.json`, JSON.stringify(replay(b)));
  await writeFile(`${out}data/settings-${b}.json`, JSON.stringify(settingsFor(b)));
}
console.log(`Wrote ${out} with ${index.budgets.length} budgets.`);
