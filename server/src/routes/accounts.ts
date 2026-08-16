import { Router } from 'express'
import { pool } from '../db.ts'
import { asyncHandler } from '../errors.ts'
import { ACCOUNT_COLUMNS, toAccount, type AccountRow } from '../services/balances.ts'

export const accountsRouter = Router()

accountsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    // last_reconciled_balance is kept current by every write path, so the live
    // balance is a plain column read.
    const { rows } = await pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS}
         FROM accounts
        ORDER BY created_at, name`,
    )
    res.json(rows.map(toAccount))
  }),
)
