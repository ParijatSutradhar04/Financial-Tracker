// Run: cd app && node --test tests/
// Node strips the TypeScript types itself; no test framework needed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toReviewRows } from '../src/splitwiseReview.ts';

const row = (fingerprint, category, extra = {}) => ({
  fingerprint,
  date: '2026-09-01',
  description: `Item ${fingerprint}`,
  amount: 100,
  category,
  confidence: category ? 0.9 : null,
  source: category ? 'laya' : null,
  alreadyImported: false,
  ...extra,
});

test('a first preview includes every new row with its suggestion', () => {
  const out = toReviewRows([row('a', 'Food'), row('b', null), row('c', 'Food', { alreadyImported: true })]);
  assert.deepEqual(
    out.map(r => [r.fingerprint, r.include, r.chosen]),
    [
      ['a', true, 'Food'],
      ['b', true, null],
    ],
  );
});

test('a re-preview keeps what the user already picked or unticked', () => {
  // Categorizer was down: the user picked a category for a and unticked b.
  const before = toReviewRows([row('a', null), row('b', null), row('c', null)]);
  before[0].chosen = 'Travel';
  before[1].include = false;

  // Retry: the categorizer is back and suggests Food for everything.
  const after = toReviewRows([row('a', 'Food'), row('b', 'Food'), row('c', 'Food')], before);
  assert.deepEqual(
    after.map(r => [r.fingerprint, r.include, r.chosen, r.category]),
    [
      ['a', true, 'Travel', 'Food'],
      ['b', false, 'Food', 'Food'],
      ['c', true, 'Food', 'Food'],
    ],
  );
});

test('a re-preview takes fresh amounts from the server', () => {
  // e.g. after changing which member is you: same expenses, different shares.
  const before = toReviewRows([row('a', 'Food')]);
  const after = toReviewRows([row('a', 'Food', { amount: 40 })], before);
  assert.equal(after[0].amount, 40);
});
