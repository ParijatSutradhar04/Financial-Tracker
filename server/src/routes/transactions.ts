import { Router } from 'express'
import { pool, withTransaction } from '../db.ts'
import { asyncHandler } from '../errors.ts'
import { lockAccounts, syncBalance } from '../services/balances.ts'
import { insertTransaction, listTransactions } from '../services/transactions.ts'
import { createTransactionSchema, transactionQuerySchema } from '../validation.ts'

export const transactionsRouter = Router()

transactionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { from, to } = transactionQuerySchema.parse(req.query)
    res.json(await listTransactions(pool, from, to))
  }),
)

transactionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createTransactionSchema.parse(req.body)

    const result = await withTransaction(async client => {
      await lockAccounts(client, [body.accountId])

      const transaction = await insertTransaction(client, {
        accountId: body.accountId,
        amount: body.amount,
        type: 'debit',
        category: body.category,
        description: body.description,
        date: body.date,
      })

      return { transaction, account: await syncBalance(client, body.accountId) }
    })

    res.status(201).json(result)
  }),
)
