// .env is loaded by Node's --env-file-if-exists flag in the package scripts.

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

export const config = {
  databaseUrl: required('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/financedb'),
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:8443').split(',').map(o => o.trim()),
  // The Postgres container runs in UTC while the dashboard groups transactions
  // by local calendar day, so every connection is pinned to this zone. That
  // keeps `to_char(...)` on the read path and date literals on the write path
  // agreeing with the clock the user is looking at.
  timezone: process.env.APP_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
}
