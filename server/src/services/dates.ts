import { config } from '../config.ts'

// en-CA formats as YYYY-MM-DD, which is also the shape the UI's date input uses.
const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's calendar date in the configured timezone, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return isoFormatter.format(now)
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number]
  return { year, month, day }
}

/**
 * Calendar days between two YYYY-MM-DD dates. Anchored to UTC noon so that a
 * daylight-saving shift in between cannot round the difference to the wrong day.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  const fromMs = Date.UTC(from.year, from.month - 1, from.day, 12)
  const toMs = Date.UTC(to.year, to.month - 1, to.day, 12)
  return Math.round((toMs - fromMs) / 86_400_000)
}
