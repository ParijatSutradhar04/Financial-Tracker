import { z } from 'zod'
import { spendCategoryNames } from './finance-config.ts'
import { todayIso } from './services/dates.ts'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

/**
 * The reconciliation trigger folds a transaction into the balance the first
 * time it sees it, so a transaction dated in the future would be counted now
 * and again once that date arrives.
 */
const notInTheFuture = isoDate.refine(date => date <= todayIso(), 'Date cannot be in the future')

const uuid = z.uuid('Expected an account id')

/** NUMERIC(12,2): at most two decimal places, and the column tops out at 10^10. */
const money = z
  .number()
  .finite()
  .refine(n => Math.round(n * 100) === Number((n * 100).toFixed(0)), 'At most two decimal places')
  .refine(n => Math.abs(n) < 1e10, 'Amount is out of range')

const positiveMoney = money.refine(n => n > 0, 'Amount must be greater than zero')

export const transactionQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
})

export const createTransactionSchema = z.object({
  accountId: uuid,
  amount: positiveMoney,
  category: z.enum(spendCategoryNames as [string, ...string[]], {
    error: () => `Category must be one of: ${spendCategoryNames.join(', ')}`,
  }),
  description: z.string().trim().min(1, 'Description is required').max(500),
  date: notInTheFuture,
})

export const createSalarySchema = z.object({
  accountId: uuid,
  amount: positiveMoney,
  description: z.string().trim().max(500).optional(),
  date: notInTheFuture,
})

export const createTransferSchema = z
  .object({
    fromAccountId: uuid,
    toAccountId: uuid,
    amount: positiveMoney,
    description: z.string().trim().max(500).optional(),
  })
  .refine(body => body.fromAccountId !== body.toAccountId, {
    message: 'Cannot transfer to the same account',
    path: ['toAccountId'],
  })

export const reconcileSchema = z.object({
  balances: z
    .array(z.object({ accountId: uuid, balance: money }))
    .min(1, 'At least one account is required')
    .refine(
      items => new Set(items.map(i => i.accountId)).size === items.length,
      'Each account may only appear once',
    ),
})
