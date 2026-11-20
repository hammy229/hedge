// The admin page's seeding loop, kept out of the JSX so node:test can check it: call
// seed until the project has every sample issue, report each status, wait while another
// admin holds the lease, and give up when calls stop making progress.

export const MAX_STALLS = 3;
export const BUSY_WAIT_MS = 5000;

export async function runSeed(call, onStatus, { maxStalls = MAX_STALLS, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = -1;
  let stalls = 0;
  for (;;) {
    const s = await call();
    onStatus(s);
    if (s?.done) return s;
    if (s?.created > last) {
      last = s.created;
      stalls = 0;
    } else {
      stalls += 1;
      if (stalls >= maxStalls) {
        throw new Error(s?.busy ? 'Another admin is adding sample issues to this project. Try again in a minute.' : 'Adding sample issues stopped making progress.');
      }
    }
    if (s?.busy) await wait(BUSY_WAIT_MS);
  }
}
