import { Router } from 'express'
import { withTransaction } from '../db.ts'
import { SALARY_CATEGORY } from '../domain.ts'
import { asyncHandler } from '../errors.ts'
import { lockAccounts, syncBalance } from '../services/balances.ts'
import { nextPayday } from '../services/payday.ts'
import { insertTransaction } from '../services/transactions.ts'
import { createSalarySchema } from '../validation.ts'

export const salaryRouter = Router()

salaryRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSalarySchema.parse(req.body)

    const result = await withTransaction(async client => {
      const accounts = await lockAccounts(client, [body.accountId])
      const account = accounts.get(body.accountId)!

      const transaction = await insertTransaction(client, {
        accountId: account.id,
        amount: body.amount,
        type: 'credit',
        category: SALARY_CATEGORY,
        description: body.description?.trim() || 'Salary credited',
        date: body.date,
      })

      return {
        transaction,
        account: await syncBalance(client, account.id),
        // Recording the credit settles this cycle, so the countdown that comes
        // back already points at the following month.
        payday: await nextPayday(client),
      }
    })

    res.status(201).json(result)
  }),
)
