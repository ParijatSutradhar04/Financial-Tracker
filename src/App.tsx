import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Account, type AppConfig, type Category, type Payday, type Transaction } from './api'

// ─── Category catalog ─────────────────────────────────────────────────────────

/**
 * Categories, their icons, and their colours all come from the backend's
 * config/finance.config.json by way of /api/config, so adding one there is the
 * only edit needed to make it appear in the picker, the totals grid, and the
 * ledger rows.
 */
interface Catalog {
  /** Categories the user may pick, in the order the config lists them. */
  spendable: Category[]
  hidden: Set<string>
  iconFor: (category: string) => string
  colorFor: (category: string) => string
}

const FALLBACK_ICON = '📦'
const FALLBACK_COLOR = '#8e8e93'

const EMPTY_CATALOG: Catalog = {
  spendable: [],
  hidden: new Set(),
  iconFor: () => FALLBACK_ICON,
  colorFor: () => FALLBACK_COLOR,
}

function buildCatalog(config: AppConfig): Catalog {
  const byName = new Map(config.categories.map(c => [c.name, c]))
  return {
    spendable: config.categories.filter(c => c.spendable),
    // Reconciliation adjustments keep the stored balance and the ledger in
    // agreement. That is bookkeeping rather than something the user did, so the
    // backend marks them hidden and they never reach the dashboard.
    hidden: new Set(config.categories.filter(c => c.hidden).map(c => c.name)),
    iconFor: name => byName.get(name)?.icon ?? FALLBACK_ICON,
    colorFor: name => byName.get(name)?.color ?? FALLBACK_COLOR,
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const pad = (n: number) => String(n).padStart(2, '0')

/** Local YYYY-MM-DD, avoiding the UTC shift that toISOString would introduce. */
function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Accounts are named "Primary Account" / "Salary Account" in the database. */
const shortName = (name: string) => name.replace(/\s*Account$/i, '')

// ─── Sub-components ───────────────────────────────────────────────────────────

function Badge({ children, color = '#5b5cf6' }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{ backgroundColor: color + '18', color, border: `1px solid ${color}30` }}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide"
    >
      {children}
    </span>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-[#e5e5e7] ${className}`}>
      {children}
    </div>
  )
}

// ─── Add Expense Modal ─────────────────────────────────────────────────────────

interface AddExpenseModalProps {
  accounts: Account[]
  catalog: Catalog
  onClose: () => void
  onAdd: (input: { accountId: string; amount: number; category: string; description: string; date: string }) => Promise<void>
}

function AddExpenseModal({ accounts, catalog, onClose, onAdd }: AddExpenseModalProps) {
  const today = isoDate(new Date())
  const banks = accounts.filter(a => a.kind === 'bank')
  const cards = accounts.filter(a => a.kind === 'credit_card')

  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [category, setCategory] = useState(catalog.spendable[0]?.name ?? '')
  const [date, setDate] = useState(today)
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = accounts.find(a => a.id === accountId)
  const selectedIsCard = selected?.kind === 'credit_card'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = parseFloat(amount)
    if (!n || n <= 0) { setError('Enter a valid amount'); return }
    if (!description.trim()) { setError('Add a description'); return }

    setSaving(true)
    setError('')
    try {
      await onAdd({ accountId, amount: n, category, description: description.trim(), date })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the expense')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1c1c1e]">Add Expense</h2>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] text-[#8e8e93] transition-colors">
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Amount</label>
          <div className="flex items-center border border-[#e5e5e7] rounded-xl px-3 focus-within:border-[#5b5cf6] focus-within:ring-2 focus-within:ring-[#5b5cf6]/10 transition-all">
            <span className="text-[#8e8e93] font-mono text-sm mr-1.5">₹</span>
            <input
              className="flex-1 py-3 text-sm text-[#1c1c1e] bg-transparent outline-none font-mono"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              type="number"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Paid with</label>
            <select
              className="border border-[#e5e5e7] rounded-xl px-3 py-3 text-sm text-[#1c1c1e] bg-white outline-none focus:border-[#5b5cf6] focus:ring-2 focus:ring-[#5b5cf6]/10 transition-all"
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
            >
              {banks.length > 0 && (
                <optgroup label="Accounts">
                  {banks.map(a => <option key={a.id} value={a.id}>{shortName(a.name)}</option>)}
                </optgroup>
              )}
              {cards.length > 0 && (
                <optgroup label="Credit Cards">
                  {cards.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Category</label>
            <select
              className="border border-[#e5e5e7] rounded-xl px-3 py-3 text-sm text-[#1c1c1e] bg-white outline-none focus:border-[#5b5cf6] focus:ring-2 focus:ring-[#5b5cf6]/10 transition-all"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              {catalog.spendable.map(c => <option key={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {selectedIsCard && (
          <p className="text-xs text-[#8e8e93] -mt-3">
            Charged to {selected?.name}, so it adds to what is owed on that card rather than
            leaving an account.
          </p>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Date</label>
          <input
            className="border border-[#e5e5e7] rounded-xl px-3 py-3 text-sm text-[#1c1c1e] bg-white outline-none focus:border-[#5b5cf6] focus:ring-2 focus:ring-[#5b5cf6]/10 transition-all"
            type="date"
            max={today}
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Description</label>
          <input
            className="border border-[#e5e5e7] rounded-xl px-3 py-3 text-sm text-[#1c1c1e] bg-white outline-none focus:border-[#5b5cf6] focus:ring-2 focus:ring-[#5b5cf6]/10 transition-all"
            placeholder="e.g. Trader Joe's run"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-[#ff3b30] -mt-2">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="bg-[#5b5cf6] text-white rounded-xl py-3 text-sm font-semibold hover:bg-[#4a4be0] active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Add Expense'}
        </button>
      </form>
    </Overlay>
  )
}

// ─── Add Salary Modal ─────────────────────────────────────────────────────────

interface AddSalaryModalProps {
  account: Account
  payday: Payday | null
  onClose: () => void
  onAdd: (input: { amount: number; date: string; description?: string }) => Promise<void>
}

function AddSalaryModal({ account, payday, onClose, onAdd }: AddSalaryModalProps) {
  const today = isoDate(new Date())
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = parseFloat(amount)
    if (!n || n <= 0) { setError('Enter a valid amount'); return }

    setSaving(true)
    setError('')
    try {
      await onAdd({ amount: n, date, description: description.trim() || undefined })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the salary')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#1c1c1e]">Add Salary</h2>
            <p className="text-xs text-[#8e8e93] mt-0.5">Credited to {shortName(account.name)}</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] text-[#8e8e93] transition-colors">
            <CloseIcon />
          </button>
        </div>

        <div className="flex items-center justify-between bg-[#f5f5f7] rounded-xl px-4 py-3">
          <div>
            <p className="text-[10px] font-medium text-[#8e8e93] uppercase tracking-widest mb-0.5">Current balance</p>
            <p className="font-mono text-sm font-semibold text-[#1c1c1e]">{fmt(account.balance)}</p>
          </div>
          {payday && (
            <div className="text-right">
              <p className="text-[10px] font-medium text-[#8e8e93] uppercase tracking-widest mb-0.5">Next payday</p>
              <p className="font-mono text-sm font-semibold text-[#1c1c1e]">{fmtDate(payday.date)}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Amount</label>
          <div className="flex items-center border border-[#e5e5e7] rounded-xl px-3 focus-within:border-[#30d158] focus-within:ring-2 focus-within:ring-[#30d158]/10 transition-all">
            <span className="text-[#8e8e93] font-mono text-sm mr-1.5">₹</span>
            <input
              className="flex-1 py-3 text-sm text-[#1c1c1e] bg-transparent outline-none font-mono"
              placeholder="0.00"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError('') }}
              type="number"
              min="0"
              step="0.01"
              autoFocus
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Date received</label>
          <input
            className="border border-[#e5e5e7] rounded-xl px-3 py-3 text-sm text-[#1c1c1e] bg-white outline-none focus:border-[#30d158] focus:ring-2 focus:ring-[#30d158]/10 transition-all"
            type="date"
            max={today}
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Note (optional)</label>
          <input
            className="border border-[#e5e5e7] rounded-xl px-3 py-3 text-sm text-[#1c1c1e] bg-white outline-none focus:border-[#30d158] focus:ring-2 focus:ring-[#30d158]/10 transition-all"
            placeholder="Salary credited"
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
        </div>

        <p className="text-xs text-[#8e8e93] -mt-2">
          Recording this settles the current cycle, so the countdown moves to next month's payday.
        </p>

        {error && <p className="text-xs text-[#ff3b30] -mt-2">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="bg-[#30d158] text-white rounded-xl py-3 text-sm font-semibold hover:bg-[#28b74c] active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Add Salary'}
        </button>
      </form>
    </Overlay>
  )
}

// ─── Transfer Modal ───────────────────────────────────────────────────────────

interface TransferModalProps {
  from: Account
  to: Account
  onClose: () => void
  onTransfer: (amount: number) => Promise<void>
}

function TransferModal({ from, to, onClose, onTransfer }: TransferModalProps) {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = parseFloat(amount)
    if (!n || n <= 0) { setError('Enter a valid amount'); return }
    if (n > from.balance) { setError(`Insufficient balance in ${shortName(from.name)} account`); return }

    setSaving(true)
    setError('')
    try {
      await onTransfer(n)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the transfer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#1c1c1e]">Transfer Funds</h2>
            <p className="text-xs text-[#8e8e93] mt-0.5">{shortName(from.name)} → {shortName(to.name)} Account</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] text-[#8e8e93] transition-colors">
            <CloseIcon />
          </button>
        </div>

        {/* Flow indicator */}
        <div className="flex items-center gap-2 bg-[#f5f5f7] rounded-xl px-4 py-3">
          <div className="flex-1 text-center">
            <p className="text-[10px] font-medium text-[#8e8e93] uppercase tracking-widest mb-0.5">From</p>
            <p className="text-sm font-semibold text-[#1c1c1e]">{shortName(from.name)}</p>
            <p className="font-mono text-xs text-[#8e8e93]">{fmt(from.balance)}</p>
          </div>
          <div className="flex flex-col items-center text-[#5b5cf6]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className="flex-1 text-center">
            <p className="text-[10px] font-medium text-[#8e8e93] uppercase tracking-widest mb-0.5">To</p>
            <p className="text-sm font-semibold text-[#1c1c1e]">{shortName(to.name)}</p>
            <p className="font-mono text-xs text-[#8e8e93]">{fmt(to.balance)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">Amount</label>
          <div className="flex items-center border border-[#e5e5e7] rounded-xl px-3 focus-within:border-[#5b5cf6] focus-within:ring-2 focus-within:ring-[#5b5cf6]/10 transition-all">
            <span className="text-[#8e8e93] font-mono text-sm mr-1.5">₹</span>
            <input
              className="flex-1 py-3 text-sm text-[#1c1c1e] bg-transparent outline-none font-mono"
              placeholder="0"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError('') }}
              type="number"
              min="0"
              step="1"
              autoFocus
            />
          </div>
          {error && <p className="text-xs text-[#ff3b30]">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={saving}
          className="bg-[#5b5cf6] text-white rounded-xl py-3 text-sm font-semibold hover:bg-[#4a4be0] active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {saving ? 'Transferring…' : 'Transfer'}
        </button>
      </form>
    </Overlay>
  )
}

// ─── Reconcile Balance Modal ───────────────────────────────────────────────────

interface ReconcileModalProps {
  accounts: Account[]
  onClose: () => void
  onReconcile: (balances: { accountId: string; balance: number }[]) => Promise<void>
}

/**
 * A card holds a negative balance for money owed, which is the right convention
 * for the ledger and the wrong one to type into a form, so cards are shown and
 * read back as the outstanding amount and flipped on the way in and out.
 */
const asShown = (account: Account) =>
  account.kind === 'credit_card' ? -account.balance : account.balance

const asStored = (account: Account, shown: number) =>
  account.kind === 'credit_card' ? -shown : shown

function ReconcileModal({ accounts, onClose, onReconcile }: ReconcileModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(accounts.map(a => [a.id, asShown(a).toFixed(2)])))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onReconcile(accounts.map(a => ({
        accountId: a.id,
        balance: asStored(a, parseFloat(values[a.id]) || 0),
      })))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the balances')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#1c1c1e]">Reconcile Balance</h2>
            <p className="text-xs text-[#8e8e93] mt-0.5">Manually correct account balance discrepancies</p>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] text-[#8e8e93] transition-colors">
            <CloseIcon />
          </button>
        </div>

        {accounts.map(account => (
          <div key={account.id} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[#48484a] uppercase tracking-widest">
              {account.name} {account.kind === 'credit_card' ? 'Outstanding' : 'Balance'}
            </label>
            <div className="flex items-center border border-[#e5e5e7] rounded-xl px-3 focus-within:border-[#8e8e93] transition-all">
              <span className="text-[#8e8e93] font-mono text-sm mr-1.5">₹</span>
              <input
                className="flex-1 py-3 text-sm text-[#1c1c1e] bg-transparent outline-none font-mono"
                type="number" step="0.01"
                value={values[account.id] ?? ''}
                onChange={e => setValues(v => ({ ...v, [account.id]: e.target.value }))}
              />
            </div>
          </div>
        ))}

        <p className="text-xs text-[#8e8e93] -mt-2">
          Any difference is recorded in the database as an Adjustment, so the ledger keeps adding up.
        </p>

        {error && <p className="text-xs text-[#ff3b30] -mt-2">{error}</p>}

        <div className="flex gap-3 mt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-[#e5e5e7] text-[#48484a] rounded-xl py-3 text-sm font-medium hover:bg-[#f5f5f7] active:scale-[0.98] transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-[#1c1c1e] text-white rounded-xl py-3 text-sm font-semibold hover:bg-[#2c2c2e] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {saving ? 'Updating…' : 'Update Balances'}
          </button>
        </div>
      </form>
    </Overlay>
  )
}

// ─── Overlay Shell ─────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md" style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.18)' }}>
        {children}
      </div>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

// ─── Sparkbar Chart ───────────────────────────────────────────────────────────

function SparkbarChart({ transactions }: { transactions: Transaction[] }) {
  const today = new Date()

  const months = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (4 - i), 1)
    return { year: d.getFullYear(), month: d.getMonth(), label: MONTH_NAMES[d.getMonth()].slice(0, 3) }
  })

  const totals = months.map(m =>
    transactions
      .filter(t => {
        const d = new Date(t.date + 'T00:00:00')
        return t.isSpend && d.getFullYear() === m.year && d.getMonth() === m.month
      })
      .reduce((s, t) => s + t.amount, 0)
  )

  const peak = Math.max(...totals, 1)

  return (
    <div className="flex items-end gap-2 h-20 w-full">
      {months.map((m, i) => {
        const pct = totals[i] / peak
        const isCurrentMonth = m.year === today.getFullYear() && m.month === today.getMonth()
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              <div className="bg-[#1c1c1e] text-white text-[10px] font-mono px-2 py-1 rounded-lg whitespace-nowrap shadow-lg">
                {fmt(totals[i])}
              </div>
            </div>
            <div className="w-full flex items-end" style={{ height: '60px' }}>
              <div
                className="w-full rounded-t-lg transition-all duration-500"
                style={{
                  height: `${Math.max(pct * 100, 4)}%`,
                  backgroundColor: isCurrentMonth ? '#5b5cf6' : '#e5e5e7',
                }}
              />
            </div>
            <span
              className="text-[10px] font-medium"
              style={{ color: isCurrentMonth ? '#5b5cf6' : '#8e8e93' }}
            >
              {m.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Balance Cards ────────────────────────────────────────────────────────────

/**
 * Accounts are rendered from whatever the backend reports rather than from a
 * fixed pair, so adding one to finance.config.json is enough to make it appear.
 * The role decides the accent and the icon; anything unrecognised falls back to
 * neutral styling rather than going missing.
 */
const ACCENTS = { primary: '#5b5cf6', salary: '#30d158', none: '#48484a' } as const

function AccountIcon({ role, color }: { role: Account['role']; color: string }) {
  if (role === 'salary') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path d="M9 2v14M5 6l4-4 4 4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M4 13h10" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <rect x="1" y="4" width="16" height="10" rx="2" stroke={color} strokeWidth="1.5"/>
      <path d="M1 8h16" stroke={color} strokeWidth="1.5"/>
      <rect x="4" y="11" width="3" height="1.5" rx="0.75" fill={color}/>
    </svg>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
      <path d="M1 8.5C1 8.5 3.5 4 8.5 4s7.5 4.5 7.5 4.5S13.5 13 8.5 13 1 8.5 1 8.5z" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="8.5" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
      <path d="M2 2l13 13M6.5 5.2C7 5 7.7 4.8 8.5 4.8c5 0 7.5 4.5 7.5 4.5s-.7 1.3-2 2.5M4.5 6.5C2.7 7.8 1 10.3 1 10.3S3.5 15 8.5 15c1.2 0 2.2-.2 3.1-.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  )
}

interface AccountCardProps {
  account: Account
  /** Set only for the salary account, whose figure is masked until asked for. */
  masked?: boolean
  onToggleMask?: () => void
}

function AccountCard({ account, masked, onToggleMask }: AccountCardProps) {
  const color = ACCENTS[account.role ?? 'none']
  const concealed = masked === true

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs font-medium text-[#8e8e93] uppercase tracking-widest">{account.name}</p>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: color + '1a' }}>
          <AccountIcon role={account.role} color={color} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <p className="font-mono text-2xl font-semibold text-[#1c1c1e] tracking-tight">
          {concealed ? '••••••' : fmt(account.balance)}
        </p>
        {onToggleMask && (
          <button onClick={onToggleMask} className="text-[#8e8e93] hover:text-[#48484a] transition-colors p-0.5">
            <EyeIcon open={!concealed} />
          </button>
        )}
      </div>
      <p className="text-xs text-[#8e8e93] mt-1">Available balance</p>
    </Card>
  )
}

/**
 * Charges on a card are debits like any other expense, so the ledger balance
 * falls below zero and `outstanding` is what the user actually owes.
 */
function CreditCardCard({ account }: { account: Account }) {
  const owed = account.outstanding ?? 0
  const inCredit = owed < 0

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <p className="text-xs font-medium text-[#8e8e93] uppercase tracking-widest">{account.name}</p>
        <div className="w-9 h-9 rounded-xl bg-[#ff9f0a]/10 flex items-center justify-center">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="3.5" width="16" height="11" rx="2" stroke="#ff9f0a" strokeWidth="1.5"/>
            <path d="M1 7.5h16" stroke="#ff9f0a" strokeWidth="1.5"/>
            <rect x="3.5" y="10.5" width="4" height="1.5" rx="0.75" fill="#ff9f0a"/>
          </svg>
        </div>
      </div>
      <p
        className="font-mono text-2xl font-semibold tracking-tight"
        style={{ color: owed > 0 ? '#ff3b30' : '#1c1c1e' }}
      >
        {fmt(Math.abs(owed))}
      </p>
      <p className="text-xs text-[#8e8e93] mt-1">
        {inCredit ? 'Credit on the card' : owed === 0 ? 'Nothing outstanding' : 'Outstanding'}
      </p>
    </Card>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const now = new Date()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [payday, setPayday] = useState<Payday | null>(null)
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [salaryVisible, setSalaryVisible] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [showAddModal, setShowAddModal] = useState(false)
  const [showReconcile, setShowReconcile] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [showSalary, setShowSalary] = useState(false)

  // The window covers the five months the trend chart draws plus whatever month
  // is being browsed, so stepping outside it triggers a refetch.
  const { from, to } = useMemo(() => {
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 4, 1)
    const viewStart = new Date(viewYear, viewMonth, 1)
    const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const viewEnd = new Date(viewYear, viewMonth + 1, 0)
    return {
      from: isoDate(trendStart < viewStart ? trendStart : viewStart),
      to: isoDate(currentEnd > viewEnd ? currentEnd : viewEnd),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewYear, viewMonth])

  // Payday is refetched alongside the ledger because crediting salary settles
  // the current cycle and moves the countdown on. The config comes with it so a
  // category or card added to the backend shows up without a reload.
  const refresh = useCallback(async () => {
    const [nextConfig, nextAccounts, nextTransactions, nextPayday] = await Promise.all([
      api.config(),
      api.accounts(),
      api.transactions(from, to),
      api.payday(),
    ])
    setCatalog(buildCatalog(nextConfig))
    setAccounts(nextAccounts)
    setTransactions(nextTransactions)
    setPayday(nextPayday)
  }, [from, to])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh()
      .then(() => { if (!cancelled) setLoadError('') })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not reach the API') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [refresh])

  // The database also changes from outside the app, through scripts/reset-db.sh
  // or psql, so pick those changes up whenever the tab comes back to the front
  // rather than showing whatever was loaded on mount.
  useEffect(() => {
    function sync() {
      if (document.visibilityState !== 'visible') return
      refresh()
        .then(() => setLoadError(''))
        .catch(err => setLoadError(err instanceof Error ? err.message : 'Could not refresh'))
    }
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [refresh])

  const bankAccounts = useMemo(() => accounts.filter(a => a.kind === 'bank'), [accounts])
  const creditCards = useMemo(() => accounts.filter(a => a.kind === 'credit_card'), [accounts])

  // Roles are declared in the backend config, so the two buttons that act on a
  // specific account keep working through a rename.
  const salaryAccount = bankAccounts.find(a => a.role === 'salary')
  const primaryAccount = bankAccounts.find(a => a.role === 'primary')

  const visible = useMemo(
    () => transactions.filter(t => !catalog.hidden.has(t.category)),
    [transactions, catalog])

  // Transactions for currently viewed month
  const monthTxns = useMemo(() =>
    visible.filter(t => {
      const d = new Date(t.date + 'T00:00:00')
      return d.getFullYear() === viewYear && d.getMonth() === viewMonth
    }), [visible, viewYear, viewMonth])

  // Totals per category, spending only
  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {}
    catalog.spendable.forEach(c => { map[c.name] = 0 })
    monthTxns.forEach(t => { if (t.isSpend) map[t.category] = (map[t.category] || 0) + t.amount })
    return map
  }, [monthTxns, catalog])

  const totalSpent = useMemo(
    () => monthTxns.reduce((s, t) => (t.isSpend ? s + t.amount : s), 0),
    [monthTxns])

  // Filtered transactions for table
  const filtered = useMemo(() =>
    activeCategory ? monthTxns.filter(t => t.category === activeCategory) : monthTxns,
    [monthTxns, activeCategory])

  function shiftMonth(dir: -1 | 1) {
    let m = viewMonth + dir
    let y = viewYear
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    setViewMonth(m)
    setViewYear(y)
    setActiveCategory(null)
  }

  if (loading && accounts.length === 0) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center text-sm text-[#8e8e93]">
        Loading your dashboard…
      </div>
    )
  }

  if (loadError && accounts.length === 0) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm font-semibold text-[#1c1c1e]">Could not load your data</p>
        <p className="text-xs text-[#8e8e93] max-w-sm">{loadError}</p>
        <p className="text-xs text-[#8e8e93]">Make sure the API is running with <span className="font-mono">pnpm dev</span> in <span className="font-mono">server/</span>.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] font-sans">
      <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col gap-6">

        {/* A refresh that fails behind the scenes would otherwise leave stale
            numbers on screen with no indication anything went wrong. */}
        {loadError && (
          <div className="rounded-xl border border-[#ff3b30]/25 bg-[#ff3b30]/8 px-4 py-3 text-xs text-[#ff3b30]">
            Showing data from the last successful load — {loadError}
          </div>
        )}

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold text-[#1c1c1e] tracking-tight">Finance</h1>
              <p className="text-xs text-[#8e8e93]">Personal dashboard</p>
            </div>
            {payday && (
              <Badge color="#5b5cf6">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M5 3v2l1.5 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                {payday.daysUntil === 0 ? 'Payday today' : `${payday.daysUntil}d to payday`}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSalary(true)}
              disabled={!salaryAccount}
              className="flex items-center gap-1.5 text-xs text-[#48484a] px-3 py-2 rounded-xl border border-[#e5e5e7] hover:bg-white transition-all font-medium disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M6.5 1v11M3 4.5l3.5-3.5 3.5 3.5" stroke="#30d158" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Add Salary
            </button>
            <button
              onClick={() => setShowTransfer(true)}
              disabled={!primaryAccount || !salaryAccount}
              className="flex items-center gap-1.5 text-xs text-[#48484a] px-3 py-2 rounded-xl border border-[#e5e5e7] hover:bg-white transition-all font-medium disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 6.5h11M7 2l4.5 4.5L7 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Transfer
            </button>
            <button
              onClick={() => setShowReconcile(true)}
              className="text-xs text-[#8e8e93] px-3 py-2 rounded-xl border border-[#e5e5e7] hover:bg-white hover:text-[#48484a] transition-all font-medium"
            >
              Reconcile
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 bg-[#5b5cf6] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#4a4be0] active:scale-[0.98] transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Add Expense
            </button>
          </div>
        </div>

        {/* ── Account Cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {bankAccounts.map(account => (
            <AccountCard
              key={account.id}
              account={account}
              masked={account.role === 'salary' ? !salaryVisible : undefined}
              onToggleMask={account.role === 'salary' ? () => setSalaryVisible(v => !v) : undefined}
            />
          ))}
        </div>

        {/* ── Credit Cards ──────────────────────────────────────────────────── */}
        {creditCards.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#48484a] uppercase tracking-widest">Credit Cards</p>
              <Badge color="#ff9f0a">
                {fmt(creditCards.reduce((sum, c) => sum + (c.outstanding ?? 0), 0))} owed
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {creditCards.map(card => <CreditCardCard key={card.id} account={card} />)}
            </div>
          </div>
        )}

        {/* ── Spending Trend ───────────────────────────────────────────────── */}
        <Card className="px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-[#48484a] uppercase tracking-widest">5-Month Trend</p>
            <Badge color="#8e8e93">Total expenses</Badge>
          </div>
          <SparkbarChart transactions={visible} />
        </Card>

        {/* ── Monthly Overview ──────────────────────────────────────────────── */}
        <Card className="p-6">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-6">
            <button onClick={() => shiftMonth(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f5f5f7] text-[#48484a] transition-colors text-lg leading-none">‹</button>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-[#1c1c1e]">{MONTH_NAMES[viewMonth]} {viewYear}</span>
              <Badge color="#1c1c1e">{fmt(totalSpent)} spent</Badge>
            </div>
            <button onClick={() => shiftMonth(1)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#f5f5f7] text-[#48484a] transition-colors text-lg leading-none">›</button>
          </div>

          {/* Category grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {catalog.spendable.map(({ name: cat, icon, color }) => {
              const total = categoryTotals[cat]
              const active = activeCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(active ? null : cat)}
                  className="text-left p-4 rounded-xl border transition-all"
                  style={{
                    backgroundColor: active ? color + '12' : '#fafafa',
                    borderColor: active ? color + '50' : '#e5e5e7',
                    boxShadow: active ? `0 0 0 2px ${color}25` : 'none',
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-base">{icon}</span>
                    {active && (
                      <span style={{ color, backgroundColor: color + '15' }} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full">Active</span>
                    )}
                  </div>
                  <p className="text-xs text-[#8e8e93] mb-1">{cat}</p>
                  <p className="font-mono text-sm font-semibold" style={{ color: total > 0 ? '#1c1c1e' : '#c7c7cc' }}>
                    {total > 0 ? fmt(total) : '—'}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Transaction table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-[#48484a] uppercase tracking-widest">
                {activeCategory ? `${activeCategory} Transactions` : 'All Transactions'}
              </p>
              {activeCategory && (
                <button
                  onClick={() => setActiveCategory(null)}
                  className="text-xs text-[#5b5cf6] hover:underline font-medium"
                >
                  Clear filter
                </button>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2 text-[#8e8e93]">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <rect x="4" y="8" width="24" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M4 13h24" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                <p className="text-sm">No transactions this month</p>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr className="border-b border-[#f0f0f0]">
                      {['Date', 'Description', 'Account', 'Amount'].map(h => (
                        <th key={h} className="text-left text-[10px] font-semibold text-[#8e8e93] uppercase tracking-widest pb-2.5 pr-4 last:pr-0 last:text-right">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(t => (
                      <tr
                        key={t.id}
                        className="border-b border-[#f5f5f7] last:border-0 hover:bg-[#fafafa] transition-colors"
                      >
                        <td className="py-3 pr-4 font-mono text-xs text-[#8e8e93] whitespace-nowrap">{fmtDate(t.date)}</td>
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-6 h-6 rounded-lg flex items-center justify-center text-[11px] flex-shrink-0"
                              style={{ backgroundColor: catalog.colorFor(t.category) + '15' }}
                            >
                              {catalog.iconFor(t.category)}
                            </span>
                            <span className="text-sm text-[#1c1c1e] font-medium">{t.description}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="text-xs px-2 py-0.5 rounded-md bg-[#f0f0f5] text-[#48484a] font-medium">{shortName(t.accountName)}</span>
                        </td>
                        <td
                          className="py-3 text-right font-mono text-sm font-semibold"
                          style={{ color: t.type === 'credit' ? '#30d158' : '#ff3b30' }}
                        >
                          {t.type === 'credit' ? '+' : '−'}{fmt(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

      </div>

      {showAddModal && accounts.length > 0 && catalog.spendable.length > 0 && (
        <AddExpenseModal
          accounts={accounts}
          catalog={catalog}
          onClose={() => setShowAddModal(false)}
          onAdd={async input => { await api.addExpense(input); await refresh() }}
        />
      )}
      {showSalary && salaryAccount && (
        <AddSalaryModal
          account={salaryAccount}
          payday={payday}
          onClose={() => setShowSalary(false)}
          onAdd={async input => {
            await api.addSalary({ accountId: salaryAccount.id, ...input })
            await refresh()
          }}
        />
      )}
      {showTransfer && primaryAccount && salaryAccount && (
        <TransferModal
          from={salaryAccount}
          to={primaryAccount}
          onClose={() => setShowTransfer(false)}
          onTransfer={async amount => {
            await api.transfer({ fromAccountId: salaryAccount.id, toAccountId: primaryAccount.id, amount })
            await refresh()
          }}
        />
      )}
      {showReconcile && accounts.length > 0 && (
        <ReconcileModal
          accounts={accounts}
          onClose={() => setShowReconcile(false)}
          onReconcile={async balances => { await api.reconcile(balances); await refresh() }}
        />
      )}
    </div>
  )
}
