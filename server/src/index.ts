import cors from 'cors'
import express from 'express'
import { config } from './config.ts'
import { pool } from './db.ts'
import { errorMiddleware } from './errors.ts'
import { accountsRouter } from './routes/accounts.ts'
import { configRouter } from './routes/config.ts'
import { paydayRouter } from './routes/payday.ts'
import { reconcileRouter } from './routes/reconcile.ts'
import { salaryRouter } from './routes/salary.ts'
import { transactionsRouter } from './routes/transactions.ts'
import { transfersRouter } from './routes/transfers.ts'
import { provisionAccounts } from './services/provision.ts'

const app = express()

app.use(cors({ origin: config.corsOrigin }))
app.use(express.json())

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok' })
  } catch {
    res.status(503).json({ status: 'unavailable' })
  }
})

app.use('/api/config', configRouter)
app.use('/api/accounts', accountsRouter)
app.use('/api/transactions', transactionsRouter)
app.use('/api/transfers', transfersRouter)
app.use('/api/salary', salaryRouter)
app.use('/api/reconcile', reconcileRouter)
app.use('/api/payday', paydayRouter)

app.use(errorMiddleware)

// Anything added to finance.config.json shows up in the database on the next
// restart, which is what makes "edit the config and redeploy" enough. It runs
// before the port opens so the first request already sees the new accounts, but
// a database that is not up yet only warns rather than stopping the API.
try {
  const { created } = await provisionAccounts()
  if (created.length > 0) console.log(`Created from config: ${created.join(', ')}`)
} catch (err) {
  console.error('Could not apply finance.config.json:', err instanceof Error ? err.message : err)
}

const server = app.listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port} (timezone ${config.timezone})`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0))
    })
  })
}
