import type { AppConfig, Category } from './api';

export function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
}

export function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD, avoiding the UTC shift toISOString would introduce. */
export function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Accounts are named "Primary Account" / "Salary Account" in the database. */
export const shortName = (name: string) => name.replace(/\s*Account$/i, '');

/**
 * Categories, their icons, and their colours all come from the backend's
 * finance.config.json by way of /api/config, so adding one there is the only
 * edit needed to make it appear in the picker, the totals grid, and the
 * ledger rows.
 */
export interface Catalog {
  /** Categories the user may pick, in the order the config lists them. */
  spendable: Category[];
  hidden: Set<string>;
  iconFor: (category: string) => string;
  colorFor: (category: string) => string;
}

const FALLBACK_ICON = '📦';
const FALLBACK_COLOR = '#8e8e93';

export const EMPTY_CATALOG: Catalog = {
  spendable: [],
  hidden: new Set(),
  iconFor: () => FALLBACK_ICON,
  colorFor: () => FALLBACK_COLOR,
};

export function buildCatalog(config: AppConfig): Catalog {
  const byName = new Map(config.categories.map(c => [c.name, c]));
  return {
    spendable: config.categories.filter(c => c.spendable),
    // Reconciliation adjustments keep the stored balance and the ledger in
    // agreement. That is bookkeeping rather than something the user did, so
    // the backend marks them hidden and they never reach the dashboard.
    hidden: new Set(config.categories.filter(c => c.hidden).map(c => c.name)),
    iconFor: name => byName.get(name)?.icon ?? FALLBACK_ICON,
    colorFor: name => byName.get(name)?.color ?? FALLBACK_COLOR,
  };
}
