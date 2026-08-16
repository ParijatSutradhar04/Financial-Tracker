import { Router } from 'express'
import { withTransaction } from '../db.ts'
import { asyncHandler } from '../errors.ts'
import { ACCOUNT_COLUMNS, lockAccounts, toAccount, type AccountRow } from '../services/balances.ts'
import { transactionsCreatedSince, type Transaction } from '../services/transactions.ts'
import { reconcileSchema } from '../validation.ts'

export const reconcileRouter = Router()

reconcileRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { balances } = reconcileSchema.parse(req.body)

    const result = await withTransaction(async client => {
      const locked = await lockAccounts(
        client,
        balances.map(b => b.accountId),
      )

      const accounts = []
      const adjustments: Transaction[] = []

      for (const { accountId, balance } of balances) {
        const before = locked.get(accountId)!

        // Unlike every other write path, this deliberately writes a balance the
        // ledger does not add up to. fn_auto_reconcile_account sees the
        // difference and records it as an Adjustment transaction.
        const { rows } = await client.query<AccountRow>(
          `UPDATE accounts
              SET last_reconciled_balance = $2
            WHERE id = $1
        RETURNING ${ACCOUNT_COLUMNS}`,
          [accountId, balance],
        )

        accounts.push(toAccount(rows[0]!))
        adjustments.push(
          ...(await transactionsCreatedSince(client, accountId, before.reconciled_at_exact)),
        )
      }

      return { accounts, adjustments }
    })

    res.json(result)
  }),
)
