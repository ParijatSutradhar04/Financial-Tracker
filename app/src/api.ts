import { supabase } from './supabase';

export interface Account {
  id: string;
  name: string;
  kind: 'bank' | 'credit_card';
  /** Which fixed button acts on this account, set in the backend config. */
  role: 'primary' | 'salary' | null;
  currency: string;
  /** Signed ledger balance. Negative on a card means that much is owed. */
  balance: number;
  /** What is owed on a card, null for a bank account. */
  outstanding: number | null;
  reconciledAt: string;
}

export interface Category {
  name: string;
  icon: string;
  color: string;
  /** Selectable in Add Expense and counted towards the monthly totals. */
  spendable: boolean;
  /** Kept out of the dashboard entirely, though still in the ledger. */
  hidden: boolean;
}

/** Accounts, cards, and categories all come from the backend config file. */
export interface AppConfig {
  categories: Category[];
}

export interface Transaction {
  id: string;
  accountId: string;
  accountName: string;
  amount: number;
  type: 'debit' | 'credit';
  category: string;
  description: string;
  date: string;
  /** False for transfers between accounts and reconciliation adjustments. */
  isSpend: boolean;
  createdAt: string;
}

export interface Payday {
  date: string;
  daysUntil: number;
  lastSalaryDate: string | null;
}

// Android/iOS have no origin to be relative to, so they need an absolute API
// origin. Web is served same-origin with the API (see /vercel.json), so it
// can stay on a relative path — unless EXPO_PUBLIC_API_URL is set, which lets
// local web dev point at a standalone `uvicorn` instead of a dev-server proxy
// Metro doesn't provide.
const API_BASE = process.env.EXPO_PUBLIC_API_URL ? `${process.env.EXPO_PUBLIC_API_URL}/api` : '/api';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(await authHeaders()),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  config: () => request<AppConfig>('/config'),

  accounts: () => request<Account[]>('/accounts'),

  transactions: (from: string, to: string) =>
    request<Transaction[]>(`/transactions?from=${from}&to=${to}`),

  payday: () => request<Payday>('/payday'),

  addExpense: (body: {
    accountId: string;
    amount: number;
    category: string;
    description: string;
    date: string;
  }) =>
    request<{ transaction: Transaction; account: Account }>('/transactions', {
      method: 'POST',
      body: json(body),
    }),

  addSalary: (body: { accountId: string; amount: number; date: string; description?: string }) =>
    request<{ transaction: Transaction; account: Account; payday: Payday }>('/salary', {
      method: 'POST',
      body: json(body),
    }),

  transfer: (body: { fromAccountId: string; toAccountId: string; amount: number }) =>
    request<{ transactions: Transaction[]; accounts: Account[] }>('/transfers', {
      method: 'POST',
      body: json(body),
    }),

  reconcile: (balances: { accountId: string; balance: number }[]) =>
    request<{ accounts: Account[]; adjustments: Transaction[] }>('/reconcile', {
      method: 'POST',
      body: json({ balances }),
    }),
};
