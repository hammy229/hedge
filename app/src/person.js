// Who gave a verdict, without storing who they are.
//
// One person's verdict must not replace another's (feedback.js), so each needs a stable mark.
// It is a hash of the issue key and account id, keyed with a secret made once per install. The
// issue key is part of it, so a person's marks on two issues cannot be matched to each other.
// Someone who holds the secret and a list of account ids could still work out who, so
// PRIVACY.md calls it pseudonymous, not anonymous.

import { createHmac, randomBytes } from 'node:crypto';

export const SECRET_KEY = 'person-secret';

// The store refuses to overwrite a secret, so when two first verdicts race the loser reads
// the winner's. A secret that cannot be read is an error: a made-up one would give a person
// a second vote.
async function secret(store) {
  const saved = await store.getSecret(SECRET_KEY);
  if (typeof saved === 'string' && saved !== '') return saved;
  let failure = null;
  try {
    await store.createSecret(SECRET_KEY, randomBytes(32).toString('hex'));
  } catch (e) {
    failure = e;
  }
  const now = await store.getSecret(SECRET_KEY);
  if (typeof now === 'string' && now !== '') return now;
  throw failure ?? new Error('The verdict secret could not be saved.');
}

export async function personMark(store, issueKey, accountId) {
  if (typeof accountId !== 'string' || accountId === '') return null;
  return createHmac('sha256', await secret(store)).update(`${issueKey}\n${accountId}`).digest('hex').slice(0, 32);
}
