// How strongly people's verdicts say Hedge is over its error budget.
//
// The check runs after every verdict. An ordinary binomial test repeated that often would
// raise a false alarm sooner or later, so this is a test that stays valid however often it
// is checked (ADR 9): a bet against "the error rate is at most the budget".
//
// Each verdict multiplies a bet's value by q/alpha if the call was wrong and
// (1-q)/(1-alpha) if it was right, for a guessed true error rate q above alpha. While the
// real rate is at most alpha, that factor averages at most 1, so by Ville's inequality the
// value ever reaches 1/FALSE_ALARM with probability at most FALSE_ALARM. The true rate is
// not known, so five bets run side by side and their average is the evidence; an average of
// such bets is one too. alpha is the budget each call was made under, so moving the dial
// between calls does not break it.

export const FALSE_ALARM = 0.05;
export const LIMIT = 1 / FALSE_ALARM;
const FACTORS = [1.5, 2, 3, 5, 10];
const MAX_RATE = 0.9;

const usable = (v) => typeof v?.wrong === 'boolean' && Number.isFinite(v.budget) && v.budget > 0 && v.budget < MAX_RATE;

// verdicts: [{ wrong: boolean, budget }], any order. Entries without a usable budget are
// skipped, since there is nothing to hold them to.
export function evidence(verdicts) {
  const list = (Array.isArray(verdicts) ? verdicts : []).filter(usable);
  const logs = FACTORS.map((f) =>
    list.reduce((sum, { wrong, budget }) => {
      const q = Math.min(f * budget, MAX_RATE);
      return sum + (wrong ? Math.log(q / budget) : Math.log((1 - q) / (1 - budget)));
    }, 0),
  );
  // Averaged in logs, so a long run of wrong calls cannot overflow.
  const top = Math.max(...logs);
  const log = top + Math.log(logs.reduce((s, l) => s + Math.exp(l - top), 0) / logs.length);
  const wrong = list.filter((v) => v.wrong).length;
  return { reviewed: list.length, wrong, log, over: log >= Math.log(LIMIT) };
}
