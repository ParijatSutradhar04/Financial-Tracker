/**
 * Categories the user can pick live in config/finance.config.json. The ones
 * below are the server's own and cannot be chosen.
 */
export const TRANSFER_CATEGORY = 'Transfer'

/** Written only by the reconciliation trigger. */
export const ADJUSTMENT_CATEGORY = 'Adjustment'

/** Monthly pay landing in the salary account. Also drives the payday countdown. */
export const SALARY_CATEGORY = 'Salary'

/**
 * Categories the server owns. They land in the ledger like anything else but
 * are not spending, so they are excluded from the dashboard's category totals
 * and trend chart.
 */
export const RESERVED_CATEGORIES = [
  TRANSFER_CATEGORY,
  ADJUSTMENT_CATEGORY,
  SALARY_CATEGORY,
] as const

/**
 * How the dashboard draws the reserved categories, alongside the icon and
 * colour each configured category carries. Adjustments are hidden outright:
 * they keep the stored balance and the ledger in agreement, which is
 * bookkeeping rather than anything the user did.
 */
export const RESERVED_CATEGORY_STYLES = [
  { name: TRANSFER_CATEGORY, icon: '🔁', color: '#5b5cf6', hidden: false },
  { name: SALARY_CATEGORY, icon: '💰', color: '#30d158', hidden: false },
  { name: ADJUSTMENT_CATEGORY, icon: '⚖️', color: '#8e8e93', hidden: true },
] as const

export const PAYDAY_DAY_OF_MONTH = 28
