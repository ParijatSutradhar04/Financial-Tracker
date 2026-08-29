import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, type Account, type Payday, type Transaction } from '../api';
import { supabase } from '../supabase';
import { EMPTY_CATALOG, MONTH_NAMES, buildCatalog, fmt, fmtDate, isoDate, shortName, type Catalog } from '../utils';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { SparkbarChart } from '../components/SparkbarChart';
import { AccountCard } from '../components/AccountCard';
import { CreditCardCard } from '../components/CreditCardCard';
import { AddExpenseModal } from '../components/modals/AddExpenseModal';
import { AddCreditModal } from '../components/modals/AddCreditModal';
import { AddAccountModal } from '../components/modals/AddAccountModal';
import { ManageCategoriesModal } from '../components/modals/ManageCategoriesModal';
import { AddSalaryModal } from '../components/modals/AddSalaryModal';
import { TransferModal } from '../components/modals/TransferModal';
import { ReconcileModal } from '../components/modals/ReconcileModal';
import { ClockIcon, EditIcon, EmptyBoxIcon, PlusIcon, SalaryUpArrowIcon, ArrowRightIcon } from '../components/icons';

export function Dashboard() {
  const now = new Date();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [payday, setPayday] = useState<Payday | null>(null);
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [salaryVisible, setSalaryVisible] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showReconcile, setShowReconcile] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showSalary, setShowSalary] = useState(false);
  const [showAddCredit, setShowAddCredit] = useState(false);
  const [addAccountKind, setAddAccountKind] = useState<'bank' | 'credit_card' | null>(null);
  const [showManageCategories, setShowManageCategories] = useState(false);

  // The window covers the five months the trend chart draws plus whatever
  // month is being browsed, so stepping outside it triggers a refetch.
  const { from, to } = useMemo(() => {
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 4, 1);
    const viewStart = new Date(viewYear, viewMonth, 1);
    const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const viewEnd = new Date(viewYear, viewMonth + 1, 0);
    return {
      from: isoDate(trendStart < viewStart ? trendStart : viewStart),
      to: isoDate(currentEnd > viewEnd ? currentEnd : viewEnd),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewYear, viewMonth]);

  // Payday is refetched alongside the ledger because crediting salary settles
  // the current cycle and moves the countdown on. The config comes with it so
  // a category or card added to the backend shows up without a reload.
  const refresh = useCallback(async () => {
    const [nextConfig, nextAccounts, nextTransactions, nextPayday] = await Promise.all([
      api.config(),
      api.accounts(),
      api.transactions(from, to),
      api.payday(),
    ]);
    setCatalog(buildCatalog(nextConfig));
    setAccounts(nextAccounts);
    setTransactions(nextTransactions);
    setPayday(nextPayday);
  }, [from, to]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refresh()
      .then(() => {
        if (!cancelled) setLoadError('');
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not reach the API');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // The database also changes from outside the app, so pick those changes up
  // whenever the app returns to the foreground rather than showing whatever
  // was loaded on mount.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      refresh()
        .then(() => setLoadError(''))
        .catch(err => setLoadError(err instanceof Error ? err.message : 'Could not refresh'));
    });
    return () => subscription.remove();
  }, [refresh]);

  const bankAccounts = useMemo(() => accounts.filter(a => a.kind === 'bank'), [accounts]);
  const creditCards = useMemo(() => accounts.filter(a => a.kind === 'credit_card'), [accounts]);

  // Roles are declared in the backend config, so the two buttons that act on
  // a specific account keep working through a rename.
  const salaryAccount = bankAccounts.find(a => a.role === 'salary');
  const primaryAccount = bankAccounts.find(a => a.role === 'primary');

  const visible = useMemo(() => transactions.filter(t => !catalog.hidden.has(t.category)), [transactions, catalog]);

  const monthTxns = useMemo(
    () =>
      visible.filter(t => {
        const d = new Date(`${t.date}T00:00:00`);
        return d.getFullYear() === viewYear && d.getMonth() === viewMonth;
      }),
    [visible, viewYear, viewMonth],
  );

  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {};
    catalog.spendable.forEach(c => {
      map[c.name] = 0;
    });
    monthTxns.forEach(t => {
      if (t.isSpend) map[t.category] = (map[t.category] || 0) + t.amount;
    });
    return map;
  }, [monthTxns, catalog]);

  const totalSpent = useMemo(() => monthTxns.reduce((s, t) => (t.isSpend ? s + t.amount : s), 0), [monthTxns]);

  const filtered = useMemo(
    () => (activeCategory ? monthTxns.filter(t => t.category === activeCategory) : monthTxns),
    [monthTxns, activeCategory],
  );

  function shiftMonth(dir: -1 | 1) {
    let m = viewMonth + dir;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    setViewMonth(m);
    setViewYear(y);
    setActiveCategory(null);
  }

  if (loading && accounts.length === 0) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-surface">
        <Text className="text-sm text-muted">Loading your dashboard…</Text>
      </SafeAreaView>
    );
  }

  if (loadError && accounts.length === 0) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-3 bg-surface px-4">
        <Text className="text-sm font-semibold text-ink">Could not load your data</Text>
        <Text className="max-w-sm text-center text-xs text-muted">{loadError}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="mx-auto w-full max-w-5xl gap-6 px-4 py-8" contentContainerStyle={{ gap: 24 }}>
        {loadError && (
          <View className="rounded-xl border border-red/25 bg-red/[0.08] px-4 py-3">
            <Text className="text-xs text-red">Showing data from the last successful load — {loadError}</Text>
          </View>
        )}

        {/* Header */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-3">
              <View>
                <Text className="text-xl font-semibold tracking-tight text-ink">Finance</Text>
                <Text className="text-xs text-muted">Personal dashboard</Text>
              </View>
              {payday && (
                <Badge color="#5b5cf6">
                  <View className="flex-row items-center gap-1">
                    <ClockIcon />
                    <Text className="text-xs font-semibold" style={{ color: '#5b5cf6' }}>
                      {payday.daysUntil === 0 ? 'Payday today' : `${payday.daysUntil}d to payday`}
                    </Text>
                  </View>
                </Badge>
              )}
            </View>
            <Pressable onPress={() => supabase.auth.signOut()}>
              <Text className="text-xs font-medium text-muted">Sign out</Text>
            </Pressable>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Pressable
              onPress={() => setShowSalary(true)}
              disabled={!salaryAccount}
              className="flex-row items-center gap-1.5 rounded-xl border border-border px-3 py-2"
              style={{ opacity: salaryAccount ? 1 : 0.4 }}
            >
              <SalaryUpArrowIcon />
              <Text className="text-xs font-medium text-ink-secondary">Add Salary</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowTransfer(true)}
              disabled={!primaryAccount || !salaryAccount}
              className="flex-row items-center gap-1.5 rounded-xl border border-border px-3 py-2"
              style={{ opacity: primaryAccount && salaryAccount ? 1 : 0.4 }}
            >
              <ArrowRightIcon />
              <Text className="text-xs font-medium text-ink-secondary">Transfer</Text>
            </Pressable>
            <Pressable onPress={() => setShowReconcile(true)} className="rounded-xl border border-border px-3 py-2">
              <Text className="text-xs font-medium text-muted">Reconcile</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowAddCredit(true)}
              disabled={accounts.length === 0}
              className="flex-row items-center gap-1.5 rounded-xl border border-border px-3 py-2"
              style={{ opacity: accounts.length === 0 ? 0.4 : 1 }}
            >
              <PlusIcon color="#30d158" />
              <Text className="text-xs font-medium text-ink-secondary">Add Credit</Text>
            </Pressable>
            <Pressable onPress={() => setShowAddModal(true)} className="flex-row items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5">
              <PlusIcon />
              <Text className="text-sm font-semibold text-white">Add Expense</Text>
            </Pressable>
          </View>
        </View>

        {/* Account Cards */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">Accounts</Text>
            <Pressable onPress={() => setAddAccountKind('bank')} className="h-6 w-6 items-center justify-center rounded-full bg-accent">
              <PlusIcon size={11} />
            </Pressable>
          </View>
          <View className="flex-row flex-wrap gap-4">
            {bankAccounts.map(account => (
              <View key={account.id} className="min-w-[260px] flex-1">
                <AccountCard
                  account={account}
                  masked={account.role === 'salary' ? !salaryVisible : undefined}
                  onToggleMask={account.role === 'salary' ? () => setSalaryVisible(v => !v) : undefined}
                />
              </View>
            ))}
          </View>
        </View>

        {/* Credit Cards */}
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <Text className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">Credit Cards</Text>
              <Pressable onPress={() => setAddAccountKind('credit_card')} className="h-6 w-6 items-center justify-center rounded-full bg-accent">
                <PlusIcon size={11} />
              </Pressable>
            </View>
            {creditCards.length > 0 && (
              <Badge color="#ff9f0a">{fmt(creditCards.reduce((sum, c) => sum + (c.outstanding ?? 0), 0))} owed</Badge>
            )}
          </View>
          {creditCards.length > 0 && (
            <View className="flex-row flex-wrap gap-4">
              {creditCards.map(card => (
                <View key={card.id} className="min-w-[260px] flex-1">
                  <CreditCardCard account={card} />
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Spending Trend */}
        <Card className="px-6 py-5">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">5-Month Trend</Text>
            <Badge color="#8e8e93">Total expenses</Badge>
          </View>
          <SparkbarChart transactions={visible} />
        </Card>

        {/* Monthly Overview */}
        <Card className="p-6">
          <View className="mb-6 flex-row items-center justify-between">
            <Pressable onPress={() => shiftMonth(-1)} className="h-8 w-8 items-center justify-center rounded-lg">
              <Text className="text-lg leading-none text-ink-secondary">‹</Text>
            </Pressable>
            <View className="flex-row items-center gap-3">
              <Text className="text-sm font-semibold text-ink">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </Text>
              <Badge color="#1c1c1e">{fmt(totalSpent)} spent</Badge>
            </View>
            <Pressable onPress={() => shiftMonth(1)} className="h-8 w-8 items-center justify-center rounded-lg">
              <Text className="text-lg leading-none text-ink-secondary">›</Text>
            </Pressable>
          </View>

          {/* Category grid */}
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">Categories</Text>
            <Pressable onPress={() => setShowManageCategories(true)} className="h-6 w-6 items-center justify-center rounded-full border border-border">
              <EditIcon />
            </Pressable>
          </View>
          <View className="mb-6 flex-row flex-wrap gap-3">
            {catalog.spendable.map(({ name: cat, icon, color }) => {
              const total = categoryTotals[cat];
              const active = activeCategory === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setActiveCategory(active ? null : cat)}
                  className="min-w-[140px] flex-1 rounded-xl border p-4"
                  style={{
                    backgroundColor: active ? color + '12' : '#fafafa',
                    borderColor: active ? color + '50' : '#e5e5e7',
                  }}
                >
                  <View className="mb-2 flex-row items-center justify-between">
                    <Text className="text-base">{icon}</Text>
                    {active && (
                      <Text
                        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ color, backgroundColor: color + '15' }}
                      >
                        Active
                      </Text>
                    )}
                  </View>
                  <Text className="mb-1 text-xs text-muted">{cat}</Text>
                  <Text className="font-mono text-sm font-semibold" style={{ color: total > 0 ? '#1c1c1e' : '#c7c7cc' }}>
                    {total > 0 ? fmt(total) : '—'}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Transactions */}
          <View>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-xs font-semibold uppercase tracking-widest text-ink-secondary">
                {activeCategory ? `${activeCategory} Transactions` : 'All Transactions'}
              </Text>
              {activeCategory && (
                <Pressable onPress={() => setActiveCategory(null)}>
                  <Text className="text-xs font-medium text-accent">Clear filter</Text>
                </Pressable>
              )}
            </View>

            {filtered.length === 0 ? (
              <View className="items-center gap-2 py-10">
                <EmptyBoxIcon />
                <Text className="text-sm text-muted">No transactions this month</Text>
              </View>
            ) : (
              <View>
                <View className="flex-row border-b border-[#f0f0f0] pb-2.5">
                  <Text className="flex-[0.9] text-[10px] font-semibold uppercase tracking-widest text-muted">Date</Text>
                  <Text className="flex-[2] text-[10px] font-semibold uppercase tracking-widest text-muted">Description</Text>
                  <Text className="flex-1 text-[10px] font-semibold uppercase tracking-widest text-muted">Account</Text>
                  <Text className="flex-1 text-right text-[10px] font-semibold uppercase tracking-widest text-muted">Amount</Text>
                </View>
                {filtered.map(t => (
                  <View key={t.id} className="flex-row items-center border-b border-surface py-3">
                    <Text className="flex-[0.9] font-mono text-xs text-muted">{fmtDate(t.date)}</Text>
                    <View className="flex-[2] flex-row items-center gap-2 pr-2">
                      <View className="h-6 w-6 items-center justify-center rounded-lg" style={{ backgroundColor: catalog.colorFor(t.category) + '15' }}>
                        <Text className="text-[11px]">{catalog.iconFor(t.category)}</Text>
                      </View>
                      <Text className="text-sm font-medium text-ink" numberOfLines={1}>
                        {t.description}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="self-start rounded-md bg-[#f0f0f5] px-2 py-0.5 text-xs font-medium text-ink-secondary">
                        {shortName(t.accountName)}
                      </Text>
                    </View>
                    <Text className="flex-1 text-right font-mono text-sm font-semibold" style={{ color: t.type === 'credit' ? '#30d158' : '#ff3b30' }}>
                      {t.type === 'credit' ? '+' : '−'}
                      {fmt(t.amount)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </Card>
      </ScrollView>

      {showAddModal && accounts.length > 0 && catalog.spendable.length > 0 && (
        <AddExpenseModal
          accounts={accounts}
          catalog={catalog}
          onClose={() => setShowAddModal(false)}
          onAdd={async input => {
            await api.addExpense(input);
            await refresh();
          }}
        />
      )}
      {showSalary && salaryAccount && (
        <AddSalaryModal
          account={salaryAccount}
          payday={payday}
          onClose={() => setShowSalary(false)}
          onAdd={async input => {
            await api.addSalary({ accountId: salaryAccount.id, ...input });
            await refresh();
          }}
        />
      )}
      {showTransfer && primaryAccount && salaryAccount && (
        <TransferModal
          from={salaryAccount}
          to={primaryAccount}
          onClose={() => setShowTransfer(false)}
          onTransfer={async amount => {
            await api.transfer({ fromAccountId: salaryAccount.id, toAccountId: primaryAccount.id, amount });
            await refresh();
          }}
        />
      )}
      {showReconcile && accounts.length > 0 && (
        <ReconcileModal
          accounts={accounts}
          onClose={() => setShowReconcile(false)}
          onReconcile={async balances => {
            await api.reconcile(balances);
            await refresh();
          }}
        />
      )}
      {showAddCredit && accounts.length > 0 && catalog.spendable.length > 0 && (
        <AddCreditModal
          accounts={accounts}
          catalog={catalog}
          onClose={() => setShowAddCredit(false)}
          onAdd={async input => {
            await api.addCredit(input);
            await refresh();
          }}
        />
      )}
      {addAccountKind && (
        <AddAccountModal
          kind={addAccountKind}
          onClose={() => setAddAccountKind(null)}
          onAdd={async input => {
            await api.addAccount(input);
            await refresh();
          }}
        />
      )}
      {showManageCategories && (
        <ManageCategoriesModal
          categories={catalog.spendable}
          onClose={() => setShowManageCategories(false)}
          onAdd={async input => {
            await api.addCategory(input);
            await refresh();
          }}
          onEdit={async (id, input) => {
            await api.updateCategory(id, input);
            await refresh();
          }}
          onDelete={async id => {
            await api.deleteCategory(id);
            await refresh();
          }}
        />
      )}
    </SafeAreaView>
  );
}
