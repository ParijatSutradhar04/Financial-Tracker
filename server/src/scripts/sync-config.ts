/**
 * Applies config/finance.config.json to the database and reports what changed.
 *
 * The API does the same thing on startup, so this only exists for the cases
 * where restarting it is not the natural move: after scripts/reset-db.sh has
 * recreated the volume, or when checking what a config edit would do.
 *
 * Run with `pnpm sync-config`.
 */
import { pool } from '../db.ts'
import { financeConfig } from '../finance-config.ts'
import { provisionAccounts } from '../services/provision.ts'

try {
  const { created, existing } = await provisionAccounts()

  for (const name of created) {
    const account = financeConfig.accounts.find(a => a.name === name)!
    const label = account.kind === 'credit_card' ? 'credit card' : 'account'
    console.log(`  created ${label} ${name} at ${account.openingBalance}`)
  }
  for (const name of existing) {
    console.log(`  ${name} already exists, left untouched`)
  }

  console.log(`  ${financeConfig.categories.length} categories served to the dashboard`)
} finally {
  await pool.end()
}
