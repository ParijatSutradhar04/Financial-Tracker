import type { PoolClient } from 'pg'
import { notFound } from '../errors.ts'
import { financeConfig } from '../finance-config.ts'

export type AccountKind = 'bank' | 'credit_card'
export type AccountRole = 'primary' | 'salary'

export interface AccountRow {
  id: string
  name: string
  kind: AccountKind
  currency: string
  last_reconciled_balance: string
  reconciled_at: Date
}

/** The columns every read of an account needs. */
export const ACCOUNT_COLUMNS = 'id, name, kind, currency, last_reconciled_balance, reconciled_at'

export interface LockedAccountRow extends AccountRow {
  /**
   * `reconciled_at` with its microseconds intact. The driver maps timestamptz
   * to a JavaScript Date, which only has millisecond resolution, so comparing
   * against the parsed value would sweep rows written in the same millisecond
   * back into range.
   */
  reconciled_at_exact: string
}

export interface Account {
  id: string
  name: string
  kind: AccountKind
  /** Which fixed button acts on this account, from the config. */
  role: AccountRole | null
  currency: string
  /** Signed ledger balance. Negative on a card means that much is owed. */
  balance: number
  /** What is owed on a card, so the dashboard need not know the sign convention. */
  outstanding: number | null
  reconciledAt: string
}

const rolesByName = new Map(
  financeConfig.accounts
    .filter(a => a.role)
    .map(a => [a.name.toLowerCase(), a.role as AccountRole]),
)

export function toAccount(row: AccountRow): Account {
  const balance = Number(row.last_reconciled_balance)
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    role: rolesByName.get(row.name.toLowerCase()) ?? null,
    currency: row.currency,
    balance,
    // A card is the same ledger read the other way round: charges are debits, so
    // the balance falls below zero and what is owed is its negation.
    outstanding: row.kind === 'credit_card' ? -balance : null,
    reconciledAt: row.reconciled_at.toISOString(),
  }
}

/**
 * Takes an exclusive lock on each account before any transaction is inserted.
 *
 * The reconciliation trigger derives the new balance from everything created
 * since `reconciled_at`, so two concurrent writers must not interleave their
 * insert and their sync. Ordering by id keeps a transfer, which locks two rows,
 * from deadlocking against a transfer running the other way.
 */
export async function lockAccounts(
  client: PoolClient,
  ids: string[],
): Promise<Map<string, LockedAccountRow>> {
  const { rows } = await client.query<LockedAccountRow>(
    `SELECT ${ACCOUNT_COLUMNS}, reconciled_at::text AS reconciled_at_exact
       FROM accounts
      WHERE id = ANY($1::uuid[])
      ORDER BY id
        FOR UPDATE`,
    [ids],
  )

  const byId = new Map(rows.map(row => [row.id, row]))
  for (const id of ids) {
    if (!byId.has(id)) throw notFound(`Account ${id} not found`)
  }
  return byId
}

/**
 * Folds every transaction created since the last sync into the stored balance.
 *
 * This is the same expression `fn_auto_reconcile_account` evaluates against the
 * pre-update row, so the trigger sees a zero difference and writes no
 * Adjustment row; it just advances `reconciled_at` past the rows we counted.
 */
export async function syncBalance(client: PoolClient, accountId: string): Promise<Account> {
  const { rows } = await client.query<AccountRow>(
    `UPDATE accounts a
        SET last_reconciled_balance = a.last_reconciled_balance + COALESCE((
              SELECT SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END)
                FROM transactions t
               WHERE t.account_id = a.id
                 AND t.created_at > a.reconciled_at
            ), 0)
      WHERE a.id = $1
  RETURNING ${ACCOUNT_COLUMNS}`,
    [accountId],
  )

  const row = rows[0]
  if (!row) throw notFound(`Account ${accountId} not found`)
  return toAccount(row)
}

/**
 * Balance the account would have once pending transactions are folded in.
 * Used to check a transfer against funds that are locked but not yet synced.
 */
export async function pendingBalance(client: PoolClient, accountId: string): Promise<number> {
  const { rows } = await client.query<{ balance: string }>(
    `SELECT a.last_reconciled_balance + COALESCE((
              SELECT SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END)
                FROM transactions t
               WHERE t.account_id = a.id
                 AND t.created_at > a.reconciled_at
            ), 0) AS balance
       FROM accounts a
      WHERE a.id = $1`,
    [accountId],
  )

  const row = rows[0]
  if (!row) throw notFound(`Account ${accountId} not found`)
  return Number(row.balance)
}
