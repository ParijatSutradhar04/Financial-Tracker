import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * The accounts, credit cards, and spend categories the dashboard knows about,
 * read from config/finance.config.json.
 *
 * This is the one place any of them are declared. The database gets its rows
 * from here on startup and the frontend gets its category list and styling from
 * /api/config, so adding a card or a category is an edit here and a restart,
 * with nothing to change in either codebase.
 */

const accountSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['bank', 'credit_card']),
  role: z.enum(['primary', 'salary']).optional(),
  currency: z.string().trim().length(3).default('INR'),
  openingBalance: z.number().finite().default(0),
})

const categorySchema = z.object({
  name: z.string().trim().min(1).max(50),
  icon: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour'),
})

const unique = <T>(items: T[], key: (item: T) => string) =>
  new Set(items.map(key)).size === items.length

const fileSchema = z
  .object({
    accounts: z.array(accountSchema).min(1, 'At least one account is required'),
    categories: z.array(categorySchema).min(1, 'At least one category is required'),
  })
  .refine(c => unique(c.accounts, a => a.name.toLowerCase()), {
    message: 'Account names must be unique',
    path: ['accounts'],
  })
  .refine(c => unique(c.categories, c => c.name.toLowerCase()), {
    message: 'Category names must be unique',
    path: ['categories'],
  })
  // A role picks out the account a fixed button acts on, so a second claimant
  // would make Add Salary or Transfer ambiguous.
  .superRefine((c, ctx) => {
    for (const role of ['primary', 'salary'] as const) {
      const holders = c.accounts.filter(a => a.role === role)
      if (holders.length > 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['accounts'],
          message: `Only one account may have role '${role}', found ${holders.length}`,
        })
      }
      if (holders.some(a => a.kind !== 'bank')) {
        ctx.addIssue({
          code: 'custom',
          path: ['accounts'],
          message: `The '${role}' account must be a bank account`,
        })
      }
    }
  })

export type ConfiguredAccount = z.infer<typeof accountSchema>
export type ConfiguredCategory = z.infer<typeof categorySchema>

export interface FinanceConfig {
  accounts: ConfiguredAccount[]
  categories: ConfiguredCategory[]
}

const DEFAULT_PATH = fileURLToPath(new URL('../config/finance.config.json', import.meta.url))

function load(): FinanceConfig {
  const path = process.env.FINANCE_CONFIG ?? DEFAULT_PATH

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`Could not read ${path}: ${err instanceof Error ? err.message : err}`)
  }

  const parsed = fileSchema.safeParse(raw)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(issue => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`${path} is not valid:\n${details}`)
  }

  return parsed.data
}

/**
 * Parsed once at import. A malformed config should stop the process rather than
 * surface as a confusing failure on the first request that happens to need it.
 */
export const financeConfig = load()

/** Categories the user may pick in the Add Expense modal. */
export const spendCategoryNames = financeConfig.categories.map(c => c.name)

export function accountByRole(role: 'primary' | 'salary'): ConfiguredAccount | undefined {
  return financeConfig.accounts.find(a => a.role === role)
}
