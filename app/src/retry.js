// Jira Cloud answers 429 when an app sends too much at once, and 503 when it sheds load.
// Both say "try again soon", usually with a Retry-After in seconds. A triage reads several
// pages of search results, so one 429 would otherwise turn a ticket into "ask" for no
// reason about the ticket itself.
//
// A 503 can come after Jira did the work, so a write that is not safe to repeat (creating
// an issue) passes statuses: [429], which Jira only sends before doing anything.
//
// The wait is capped: a Forge function has seconds, not minutes, so a long Retry-After is
// returned to the caller as the failure it is.

const RETRY = Object.freeze([429, 503]);
const BASE_MS = 500;
export const MAX_WAIT_MS = 5000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry-After in seconds when Jira sent one, else 500 ms doubling per attempt with up to
// 20% jitter, so parallel window reads do not retry in lockstep.
export function retryDelay(res, attempt, jitter = Math.random) {
  const header = res?.headers?.get?.('retry-after');
  const seconds = header === null || header === undefined ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return Math.round(BASE_MS * 2 ** attempt * (1 + 0.2 * jitter()));
}

// budget, when given, is shared by every request of one invocation: { ms } of waiting left,
// spent by each sleep. A triage makes up to a dozen reads, and three waits each would pass
// Forge's 25 s limit, which kills the function before it logs anything.
export async function withRetry(send, { tries = 3, sleep = pause, jitter = Math.random, statuses = RETRY, budget = null } = {}) {
  let res;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    res = await send();
    if (!statuses.includes(res?.status) || attempt === tries - 1) return res;
    const wait = retryDelay(res, attempt, jitter);
    if (wait > MAX_WAIT_MS || (budget && wait > budget.ms)) return res;
    if (budget) budget.ms -= wait;
    await sleep(wait);
  }
  return res;
}
