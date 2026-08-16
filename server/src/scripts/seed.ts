/**
 * Loads the sample ledger the dashboard used to hold in a hardcoded array, so a
 * freshly created database has something to render.
 *
 * Run with `pnpm seed`. Refuses to run against a database that already has
 * transactions unless `--force` is passed, since the immutability trigger means
 * seeded rows can never be removed.
 */
import { pool, withTransaction } from '../db.ts'
import { ADJUSTMENT_CATEGORY } from '../domain.ts'
import { lockAccounts, pendingBalance, syncBalance } from '../services/balances.ts'
import { insertTransaction } from '../services/transactions.ts'

interface SeedRow {
  date: string
  description: string
  account: 'Primary Account' | 'Salary Account'
  category: string
  amount: number
}

/** Balances the mock dashboard displayed, reproduced once the ledger is loaded. */
const TARGET_BALANCES: Record<string, number> = {
  'Primary Account': 124308,
  'Salary Account': 287500,
}

const SEED: SeedRow[] = [
  { date: '2026-08-01', description: 'Monthly Rent', account: 'Primary Account', category: 'Rent', amount: 22000 },
  { date: '2026-08-02', description: 'DMart Supermarket', account: 'Primary Account', category: 'Grocery', amount: 3840 },
  { date: '2026-08-03', description: 'Cult.fit Membership', account: 'Salary Account', category: 'Gym', amount: 1999 },
  { date: '2026-08-04', description: 'BESCOM Electricity', account: 'Primary Account', category: 'Electricity', amount: 1420 },
  { date: '2026-08-05', description: 'Farzi Cafe Dinner', account: 'Primary Account', category: 'Food', amount: 2800 },
  { date: '2026-08-07', description: 'Big Basket Order', account: 'Primary Account', category: 'Grocery', amount: 2150 },
  { date: '2026-08-09', description: 'PVR Cinema', account: 'Salary Account', category: 'Outing', amount: 900 },
  { date: '2026-08-11', description: 'Spotify Premium', account: 'Primary Account', category: 'Others', amount: 179 },
  { date: '2026-08-12', description: 'Social Restaurant', account: 'Primary Account', category: 'Food', amount: 1650 },
  { date: '2026-08-13', description: 'Reliance Fresh', account: 'Salary Account', category: 'Grocery', amount: 1980 },
  { date: '2026-08-14', description: 'Bowling & Arcade', account: 'Primary Account', category: 'Outing', amount: 1200 },
  { date: '2026-08-15', description: 'AWS Cloud Services', account: 'Salary Account', category: 'Others', amount: 2850 },

  { date: '2026-07-01', description: 'Monthly Rent', account: 'Primary Account', category: 'Rent', amount: 22000 },
  { date: '2026-07-05', description: 'DMart Supermarket', account: 'Primary Account', category: 'Grocery', amount: 3190 },
  { date: '2026-07-10', description: 'Cult.fit Membership', account: 'Salary Account', category: 'Gym', amount: 1999 },
  { date: '2026-07-15', description: 'Toit Brewpub', account: 'Primary Account', category: 'Food', amount: 2200 },
  { date: '2026-07-20', description: 'Comedy Store Show', account: 'Salary Account', category: 'Outing', amount: 800 },
  { date: '2026-07-25', description: 'BESCOM Electricity', account: 'Primary Account', category: 'Electricity', amount: 1310 },

  { date: '2026-06-01', description: 'Monthly Rent', account: 'Primary Account', category: 'Rent', amount: 22000 },
  { date: '2026-06-06', description: 'Big Basket Order', account: 'Primary Account', category: 'Grocery', amount: 2760 },
  { date: '2026-06-12', description: 'Cult.fit Membership', account: 'Salary Account', category: 'Gym', amount: 1999 },
  { date: '2026-06-15', description: 'Karavalli Dinner', account: 'Primary Account', category: 'Food', amount: 3400 },
  { date: '2026-06-22', description: 'Lal Bagh Concert', account: 'Salary Account', category: 'Outing', amount: 600 },
  { date: '2026-06-26', description: 'BESCOM Electricity', account: 'Primary Account', category: 'Electricity', amount: 1580 },

  { date: '2026-05-01', description: 'Monthly Rent', account: 'Primary Account', category: 'Rent', amount: 22000 },
  { date: '2026-05-04', description: 'Reliance Fresh', account: 'Primary Account', category: 'Grocery', amount: 4100 },
  { date: '2026-05-11', description: 'Cult.fit Membership', account: 'Salary Account', category: 'Gym', amount: 1999 },
  { date: '2026-05-14', description: 'BESCOM Electricity', account: 'Primary Account', category: 'Electricity', amount: 1720 },
  { date: '2026-05-20', description: 'Rooftop Lounge', account: 'Primary Account', category: 'Outing', amount: 3200 },
  { date: '2026-05-26', description: 'Truffles Burger', account: 'Primary Account', category: 'Food', amount: 980 },

  { date: '2026-04-01', description: 'Monthly Rent', account: 'Primary Account', category: 'Rent', amount: 22000 },
  { date: '2026-04-07', description: 'DMart Supermarket', account: 'Primary Account', category: 'Grocery', amount: 3520 },
  { date: '2026-04-14', description: 'Cult.fit Membership', account: 'Salary Account', category: 'Gym', amount: 1999 },
  { date: '2026-04-18', description: 'BESCOM Electricity', account: 'Primary Account', category: 'Electricity', amount: 1250 },
  { date: '2026-04-24', description: 'Indiranagar Pub Hop', account: 'Salary Account', category: 'Outing', amount: 2400 },
]

async function main() {
  const force = process.argv.includes('--force')

  const { rows: existing } = await pool.query<{ count: string }>('SELECT count(*) FROM transactions')
  if (Number(existing[0]!.count) > 0 && !force) {
    console.error(
      `Database already has ${existing[0]!.count} transaction(s). ` +
        'Seeding would add to them and transactions cannot be deleted. Pass --force to seed anyway.',
    )
    process.exitCode = 1
    return
  }

  const { rows: accountRows } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM accounts',
  )
  const accountIds = new Map(accountRows.map(row => [row.name, row.id]))

  for (const name of Object.keys(TARGET_BALANCES)) {
    if (!accountIds.has(name)) throw new Error(`Account "${name}" is missing. Did init.sql run?`)
  }

  await withTransaction(async client => {
    const ids = [...accountIds.values()]
    await lockAccounts(client, ids)

    // Top each account up first so that, once the back-dated expenses below are
    // applied, the balance lands on the figure the mock dashboard showed. This
    // goes in as an Adjustment, which the dashboard excludes from spending.
    for (const [name, target] of Object.entries(TARGET_BALANCES)) {
      const id = accountIds.get(name)!
      const spend = SEED.filter(row => row.account === name).reduce((sum, row) => sum + row.amount, 0)
      const delta = target + spend - (await pendingBalance(client, id))

      if (delta !== 0) {
        await insertTransaction(client, {
          accountId: id,
          amount: Math.abs(delta),
          type: delta > 0 ? 'credit' : 'debit',
          category: ADJUSTMENT_CATEGORY,
          description: 'Opening balance',
          date: '2026-03-31',
        })
      }
    }

    for (const row of SEED) {
      await insertTransaction(client, {
        accountId: accountIds.get(row.account)!,
        amount: row.amount,
        type: 'debit',
        category: row.category,
        description: row.description,
        date: row.date,
      })
    }

    for (const id of ids) {
      const account = await syncBalance(client, id)
      console.log(`${account.name}: ${account.balance}`)
    }
  })

  console.log(`Seeded ${SEED.length} transactions.`)
}

main()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
