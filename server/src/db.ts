import pg from 'pg'
import { config } from './config.ts'

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  options: `-c timezone=${config.timezone}`,
})

// Idle connections break whenever Postgres goes away, which scripts/reset-db.sh
// does deliberately. Without a listener that surfaces as an unhandled 'error'
// event and takes the process down; the pool discards the client either way.
pool.on('error', error => {
  console.error('Idle database connection failed, it will be replaced:', error.message)
})

export type Db = pg.Pool | pg.PoolClient

/**
 * Runs `fn` inside a single database transaction. Every balance-changing route
 * uses this so that the row locks it takes are held until the balance has been
 * re-synced.
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
