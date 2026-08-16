import { pool } from '../db.ts'
import { financeConfig } from '../finance-config.ts'

export interface ProvisionResult {
  created: string[]
  existing: string[]
}

/**
 * Creates a row for every account and credit card in the config that the
 * database does not have yet, and leaves the rest alone.
 *
 * Only inserts, deliberately. An account already carries a balance the ledger
 * agrees with, so writing openingBalance over it on every restart would undo
 * the user's history; and rows are never removed because transactions reference
 * them. Editing a name in the config therefore reads as adding a new account
 * rather than renaming an old one.
 *
 * Because this is an INSERT it does not fire the reconciliation trigger, which
 * only watches updates, so a new account starts at its opening balance with an
 * empty ledger and no Adjustment row.
 */
export async function provisionAccounts(): Promise<ProvisionResult> {
  const created: string[] = []
  const existing: string[] = []

  for (const account of financeConfig.accounts) {
    const { rows } = await pool.query<{ name: string }>(
      `INSERT INTO accounts (name, kind, currency, last_reconciled_balance)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO NOTHING
         RETURNING name`,
      [account.name, account.kind, account.currency, account.openingBalance],
    )

    if (rows.length > 0) created.push(account.name)
    else existing.push(account.name)
  }

  return { created, existing }
}
