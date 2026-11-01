import type { Account, AccountInput } from './api';

export interface AccountForm {
  kind: 'bank' | 'credit_card';
  name: string;
  /** Outstanding on a card, amount available in a bank account. Blank is 0. */
  amount: string;
  /** Cards only; blank means none was given. */
  limit: string;
}

/** Turns what was typed in Add Account into the request body, or says what's wrong. */
export function toAccountInput(form: AccountForm): { input: AccountInput } | { error: string } {
  const name = form.name.trim();
  if (!name) return { error: 'Enter a name' };

  const amount = form.amount.trim() ? Number(form.amount.trim()) : 0;
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Enter a valid amount' };

  if (form.kind === 'bank') return { input: { name, kind: 'bank', openingBalance: amount } };

  const limit = form.limit.trim() ? Number(form.limit.trim()) : null;
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) return { error: 'Enter a valid credit limit' };

  // Outstanding is what's owed on the card, stored as a negative balance;
  // AccountOut derives outstanding = -balance on the way back out.
  return { input: { name, kind: 'credit_card', openingBalance: amount ? -amount : 0, creditLimit: limit } };
}

/**
 * How much more a card can take. `used` is the share of the limit owed,
 * kept within 0..1 so it can size a bar; `available` goes negative over the limit.
 */
export function cardHeadroom(card: Pick<Account, 'outstanding' | 'creditLimit'>) {
  if (card.creditLimit === null) return null;
  const owed = card.outstanding ?? 0;
  return {
    limit: card.creditLimit,
    available: card.creditLimit - owed,
    used: Math.min(1, Math.max(0, owed / card.creditLimit)),
  };
}

/** The word typed on the reset screen, which the API checks too. */
export const RESET_WORD = 'RESET';

export const isResetConfirmed = (typed: string) => typed.trim() === RESET_WORD;
