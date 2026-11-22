// Local preview of Hedge, no Jira needed: `npm run preview`, then open the printed URL.
//
// Serves one page, the app's own view code (src/view.js and the act.js labels it imports,
// so the wording matches the Forge panel exactly) and two read-only endpoints backed by
// preview/replay.js. Only the files listed below are served, and only on 127.0.0.1.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { replay, settingsFor } from './replay.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const FILES = {
  '/': [here('./index.html'), 'text/html; charset=utf-8'],
  '/app.js': [here('./app.js'), 'text/javascript; charset=utf-8'],
  '/style.css': [here('./style.css'), 'text/css; charset=utf-8'],
  '/src/view.js': [here('../src/view.js'), 'text/javascript; charset=utf-8'],
  '/src/act.js': [here('../src/act.js'), 'text/javascript; charset=utf-8'],
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET') return send(res, 405, '{"error":"GET only"}');
  if (url.pathname === '/api/replay' || url.pathname === '/api/settings') {
    const raw = url.searchParams.get('budget');
    const budget = raw === null ? undefined : Number(raw);
    try {
      const body = url.pathname === '/api/replay' ? replay(budget) : settingsFor(budget);
      if (url.pathname === '/api/settings') replay(budget); // refuse budgets the policy does not offer
      return send(res, 200, JSON.stringify(body));
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
  }
  const file = FILES[url.pathname];
  if (!file) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  return send(res, 200, await readFile(file[0]), file[1]);
}

export function start(port = 5173) {
  const server = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, '{"error":"preview failed"}'));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await start(Number(process.env.PORT) || 5173);
  console.log(`Hedge preview: http://localhost:${server.address().port}`);
}
