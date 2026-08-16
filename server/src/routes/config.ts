import { Router } from 'express'
import { RESERVED_CATEGORY_STYLES } from '../domain.ts'
import { asyncHandler } from '../errors.ts'
import { financeConfig } from '../finance-config.ts'

export const configRouter = Router()

export interface CategoryView {
  name: string
  icon: string
  color: string
  /** Selectable in Add Expense and counted towards the monthly totals. */
  spendable: boolean
  /** Kept out of the dashboard entirely, though still in the ledger. */
  hidden: boolean
}

/**
 * Hands the frontend its category list and styling so neither is duplicated
 * there. Adding a category to config/finance.config.json makes it appear in the
 * picker, the totals grid, and the ledger icons after a restart.
 *
 * The reserved categories come last because the user never picks them; they
 * only need an icon and a colour for rows the server writes.
 */
configRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const categories: CategoryView[] = [
      ...financeConfig.categories.map(c => ({ ...c, spendable: true, hidden: false })),
      ...RESERVED_CATEGORY_STYLES.map(c => ({ ...c, spendable: false })),
    ]

    res.json({ categories })
  }),
)
