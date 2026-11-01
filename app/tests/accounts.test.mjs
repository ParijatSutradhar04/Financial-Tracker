// Run: cd app && node --test tests/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardHeadroom, isResetConfirmed, toAccountInput } from '../src/accounts.ts';

const form = (kind, name, amount, limit = '') => toAccountInput({ kind, name, amount, limit });

test('a card sends what is owed as a negative balance, with its limit', () => {
  assert.deepEqual(form('credit_card', ' Travel Card ', '12000.50', '150000'), {
    input: { name: 'Travel Card', kind: 'credit_card', openingBalance: -12000.5, creditLimit: 150000 },
  });
});

test('a card may leave the limit blank', () => {
  assert.deepEqual(form('credit_card', 'Travel Card', '', ' '), {
    input: { name: 'Travel Card', kind: 'credit_card', openingBalance: 0, creditLimit: null },
  });
});

test('a bank account sends the amount available and never a limit', () => {
  assert.deepEqual(form('bank', 'Primary Account', '24864.12', '5000'), {
    input: { name: 'Primary Account', kind: 'bank', openingBalance: 24864.12 },
  });
});

test('the form names what is wrong', () => {
  assert.deepEqual(form('bank', '  ', '10'), { error: 'Enter a name' });
  assert.deepEqual(form('bank', 'Savings', '-5'), { error: 'Enter a valid amount' });
  assert.deepEqual(form('bank', 'Savings', 'abc'), { error: 'Enter a valid amount' });
  assert.deepEqual(form('credit_card', 'Card', '0', '0'), { error: 'Enter a valid credit limit' });
  assert.deepEqual(form('credit_card', 'Card', '0', 'lots'), { error: 'Enter a valid credit limit' });
});

test('headroom is the limit less what is owed', () => {
  assert.deepEqual(cardHeadroom({ outstanding: 30000, creditLimit: 120000 }), { limit: 120000, available: 90000, used: 0.25 });
});

test('headroom stays within the bar when over the limit or in credit', () => {
  assert.deepEqual(cardHeadroom({ outstanding: 130000, creditLimit: 120000 }), { limit: 120000, available: -10000, used: 1 });
  assert.deepEqual(cardHeadroom({ outstanding: -500, creditLimit: 1000 }), { limit: 1000, available: 1500, used: 0 });
});

test('no limit, no headroom', () => {
  assert.equal(cardHeadroom({ outstanding: 500, creditLimit: null }), null);
});

test('reset needs the exact word', () => {
  assert.equal(isResetConfirmed('RESET'), true);
  assert.equal(isResetConfirmed(' RESET '), true);
  assert.equal(isResetConfirmed('reset'), false);
  assert.equal(isResetConfirmed(''), false);
});
