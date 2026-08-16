import type { Db } from '../db.ts'
import { PAYDAY_DAY_OF_MONTH, SALARY_CATEGORY } from '../domain.ts'
import { daysBetween, parseIsoDate, todayIso } from './dates.ts'

export interface Payday {
  date: string
  daysUntil: number
  /** Date of the salary credit that closed the previous cycle, if there is one. */
  lastSalaryDate: string | null
}

/** The 28th of the given month, where month 13 rolls into January of the next year. */
function paydayOn(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, PAYDAY_DAY_OF_MONTH, 12)).toISOString().slice(0, 10)
}

export async function lastSalaryDate(db: Db): Promise<string | null> {
  const { rows } = await db.query<{ date: string | null }>(
    `SELECT to_char(max(transaction_date), 'YYYY-MM-DD') AS date
       FROM transactions
      WHERE category = $1 AND type = 'credit'`,
    [SALARY_CATEGORY],
  )
  return rows[0]?.date ?? null
}

/**
 * Payday is the 28th. It normally falls in the current month, moving to the next
 * one after the 28th has passed, and the countdown reads 0 on the day itself.
 *
 * Once salary has actually been credited for the upcoming payday, that cycle is
 * settled and the countdown jumps to the following month rather than sitting at
 * a payday that has already been paid.
 */
export function resolvePayday(today: string, salaryDate: string | null): Payday {
  const { year, month, day } = parseIsoDate(today)

  let date = paydayOn(year, month + (day > PAYDAY_DAY_OF_MONTH ? 1 : 0))

  if (salaryDate) {
    // Anything credited after the previous payday belongs to the cycle now
    // being counted down to, so that cycle is already satisfied.
    const candidate = parseIsoDate(date)
    if (salaryDate > paydayOn(candidate.year, candidate.month - 1)) {
      date = paydayOn(candidate.year, candidate.month + 1)
    }
  }

  return { date, daysUntil: daysBetween(today, date), lastSalaryDate: salaryDate }
}

export async function nextPayday(db: Db, today: string = todayIso()): Promise<Payday> {
  return resolvePayday(today, await lastSalaryDate(db))
}
