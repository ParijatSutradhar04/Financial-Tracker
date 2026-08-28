import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Account } from '../../api';
import type { Catalog } from '../../utils';
import { isoDate, shortName } from '../../utils';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';
import { Select } from '../Select';
import { DateField } from '../DateField';

interface AddExpenseModalProps {
  accounts: Account[];
  catalog: Catalog;
  onClose: () => void;
  onAdd: (input: { accountId: string; amount: number; category: string; description: string; date: string }) => Promise<void>;
}

export function AddExpenseModal({ accounts, catalog, onClose, onAdd }: AddExpenseModalProps) {
  const today = isoDate(new Date());
  const banks = accounts.filter(a => a.kind === 'bank');
  const cards = accounts.filter(a => a.kind === 'credit_card');

  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [category, setCategory] = useState(catalog.spendable[0]?.name ?? '');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selected = accounts.find(a => a.id === accountId);
  const selectedIsCard = selected?.kind === 'credit_card';

  async function submit() {
    const n = parseFloat(amount);
    if (!n || n <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (!description.trim()) {
      setError('Add a description');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onAdd({ accountId, amount: n, category, description: description.trim(), date });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the expense');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-ink">Add Expense</Text>
          <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Amount</Text>
          <View className="flex-row items-center rounded-xl border border-border px-3">
            <Text className="mr-1.5 font-mono text-sm text-muted">₹</Text>
            <TextInput
              className="flex-1 py-3 font-mono text-sm text-ink"
              placeholder="0.00"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <View className="flex-row gap-4">
          <View className="flex-1 gap-1">
            <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Paid with</Text>
            <Select
              value={accountId}
              onChange={setAccountId}
              groups={[
                ...(banks.length > 0 ? [{ label: 'Accounts', options: banks.map(a => ({ label: shortName(a.name), value: a.id })) }] : []),
                ...(cards.length > 0 ? [{ label: 'Credit Cards', options: cards.map(a => ({ label: a.name, value: a.id })) }] : []),
              ]}
            />
          </View>
          <View className="flex-1 gap-1">
            <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Category</Text>
            <Select
              value={category}
              onChange={setCategory}
              options={catalog.spendable.map(c => ({ label: c.name, value: c.name }))}
            />
          </View>
        </View>

        {selectedIsCard && (
          <Text className="-mt-3 text-xs text-muted">
            Charged to {selected?.name}, so it adds to what is owed on that card rather than leaving an account.
          </Text>
        )}

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Date</Text>
          <DateField value={date} onChange={setDate} maximumDate={new Date()} />
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Description</Text>
          <TextInput
            className="rounded-xl border border-border px-3 py-3 text-sm text-ink"
            placeholder="e.g. Trader Joe's run"
            value={description}
            onChangeText={setDescription}
          />
        </View>

        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}

        <Pressable onPress={submit} disabled={saving} className="rounded-xl bg-accent py-3" style={{ opacity: saving ? 0.5 : 1 }}>
          <Text className="text-center text-sm font-semibold text-white">{saving ? 'Saving…' : 'Add Expense'}</Text>
        </Pressable>
      </View>
    </Overlay>
  );
}
