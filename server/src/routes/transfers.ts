import { Router } from 'express'
import { withTransaction } from '../db.ts'
import { TRANSFER_CATEGORY } from '../domain.ts'
import { asyncHandler, badRequest } from '../errors.ts'
import { lockAccounts, pendingBalance, syncBalance } from '../services/balances.ts'
import { insertTransaction } from '../services/transactions.ts'
import { createTransferSchema } from '../validation.ts'

export const transfersRouter = Router()

transfersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createTransferSchema.parse(req.body)

    const result = await withTransaction(async client => {
      const accounts = await lockAccounts(client, [body.fromAccountId, body.toAccountId])
      const from = accounts.get(body.fromAccountId)!
      const to = accounts.get(body.toAccountId)!

      const available = await pendingBalance(client, from.id)
      if (available < body.amount) {
        throw badRequest(`Insufficient balance in ${from.name}`, { available })
      }

      const note = body.description?.trim()
      const debit = await insertTransaction(client, {
        accountId: from.id,
        amount: body.amount,
        type: 'debit',
        category: TRANSFER_CATEGORY,
        description: note || `Transfer to ${to.name}`,
      })
      const credit = await insertTransaction(client, {
        accountId: to.id,
        amount: body.amount,
        type: 'credit',
        category: TRANSFER_CATEGORY,
        description: note || `Transfer from ${from.name}`,
      })

      return {
        transactions: [debit, credit],
        accounts: [await syncBalance(client, from.id), await syncBalance(client, to.id)],
      }
    })

    res.status(201).json(result)
  }),
)
