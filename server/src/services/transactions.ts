import type { PoolClient } from 'pg'
import type { Db } from '../db.ts'
import { RESERVED_CATEGORIES } from '../domain.ts'
import { todayIso } from './dates.ts'

export type TransactionType = 'debit' | 'credit'

interface TransactionRow {
  id: string
  account_id: string
  account_name: string
  amount: string
  type: TransactionType
  category: string
  description: string | null
  date: string
  created_at: Date
}

export interface Transaction {
  id: string
  accountId: string
  accountName: string
  amount: number
  type: TransactionType
  category: string
  description: string
  date: string
  isSpend: boolean
  createdAt: string
}

const reserved: readonly string[] = RESERVED_CATEGORIES

function toTransaction(row: TransactionRow): Transaction {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    amount: Number(row.amount),
    type: row.type,
    category: row.category,
    description: row.description ?? '',
    date: row.date,
    // Transfers move money between the user's own accounts and adjustments
    // correct a stale balance, so neither is spending even though both are
    // debits on one side.
    isSpend: row.type === 'debit' && !reserved.includes(row.category),
    createdAt: row.created_at.toISOString(),
  }
}

const SELECT_TRANSACTION = `
  SELECT t.id,
         t.account_id,
         a.name AS account_name,
         t.amount,
         t.type,
         t.category,
         t.description,
         to_char(t.transaction_date, 'YYYY-MM-DD') AS date,
         t.created_at
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id`

export async function listTransactions(db: Db, from?: string, to?: string): Promise<Transaction[]> {
  const { rows } = await db.query<TransactionRow>(
    `${SELECT_TRANSACTION}
      WHERE ($1::date IS NULL OR t.transaction_date >= $1::date)
        AND ($2::date IS NULL OR t.transaction_date < $2::date + INTERVAL '1 day')
      ORDER BY t.transaction_date DESC, t.created_at DESC`,
    [from ?? null, to ?? null],
  )
  return rows.map(toTransaction)
}

export interface NewTransaction {
  accountId: string
  amount: number
  type: TransactionType
  category: string
  description: string
  /** YYYY-MM-DD. Defaults to now when omitted. */
  date?: string
}

export async function insertTransaction(client: PoolClient, input: NewTransaction): Promise<Transaction> {
  // An entry dated today gets the current clock time so same-day entries stay
  // in insertion order; a back-dated one lands at midnight on its own day.
  const backdated = input.date && input.date !== todayIso() ? `${input.date} 00:00:00` : null

  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (account_id, amount, type, category, description, transaction_date)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, clock_timestamp()))
     RETURNING id`,
    [input.accountId, input.amount, input.type, input.category, input.description, backdated],
  )

  const { rows: full } = await client.query<TransactionRow>(`${SELECT_TRANSACTION} WHERE t.id = $1`, [
    rows[0]!.id,
  ])
  return toTransaction(full[0]!)
}

/**
 * Transactions created for an account since the given instant, newest first.
 * `since` must be a Postgres timestamp literal rather than a Date so that the
 * comparison keeps microsecond resolution.
 */
export async function transactionsCreatedSince(
  client: PoolClient,
  accountId: string,
  since: string,
): Promise<Transaction[]> {
  const { rows } = await client.query<TransactionRow>(
    `${SELECT_TRANSACTION}
      WHERE t.account_id = $1 AND t.created_at > $2::timestamptz
      ORDER BY t.created_at DESC`,
    [accountId, since],
  )
  return rows.map(toTransaction)
}
