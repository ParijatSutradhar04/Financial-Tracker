import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Account, Payday } from '../../api';
import { fmt, fmtDate, isoDate, shortName } from '../../utils';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';
import { DateField } from '../DateField';

interface AddSalaryModalProps {
  account: Account;
  payday: Payday | null;
  onClose: () => void;
  onAdd: (input: { amount: number; date: string; description?: string }) => Promise<void>;
}

export function AddSalaryModal({ account, payday, onClose, onAdd }: AddSalaryModalProps) {
  const today = isoDate(new Date());
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const n = parseFloat(amount);
    if (!n || n <= 0) {
      setError('Enter a valid amount');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onAdd({ amount: n, date, description: description.trim() || undefined });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the salary');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-semibold text-ink">Add Salary</Text>
            <Text className="mt-0.5 text-xs text-muted">Credited to {shortName(account.name)}</Text>
          </View>
          <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        <View className="flex-row items-center justify-between rounded-xl bg-surface px-4 py-3">
          <View>
            <Text className="mb-0.5 text-[10px] font-medium uppercase tracking-widest text-muted">Current balance</Text>
            <Text className="font-mono text-sm font-semibold text-ink">{fmt(account.balance)}</Text>
          </View>
          {payday && (
            <View className="items-end">
              <Text className="mb-0.5 text-[10px] font-medium uppercase tracking-widest text-muted">Next payday</Text>
              <Text className="font-mono text-sm font-semibold text-ink">{fmtDate(payday.date)}</Text>
            </View>
          )}
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Amount</Text>
          <View className="flex-row items-center rounded-xl border border-border px-3">
            <Text className="mr-1.5 font-mono text-sm text-muted">₹</Text>
            <TextInput
              className="flex-1 py-3 font-mono text-sm text-ink"
              placeholder="0.00"
              value={amount}
              onChangeText={t => {
                setAmount(t);
                setError('');
              }}
              keyboardType="decimal-pad"
              autoFocus
            />
          </View>
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Date received</Text>
          <DateField value={date} onChange={setDate} maximumDate={new Date()} />
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Note (optional)</Text>
          <TextInput
            className="rounded-xl border border-border px-3 py-3 text-sm text-ink"
            placeholder="Salary credited"
            value={description}
            onChangeText={setDescription}
          />
        </View>

        <Text className="-mt-2 text-xs text-muted">
          Recording this settles the current cycle, so the countdown moves to next month's payday.
        </Text>

        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}

        <Pressable onPress={submit} disabled={saving} className="rounded-xl bg-green py-3" style={{ opacity: saving ? 0.5 : 1 }}>
          <Text className="text-center text-sm font-semibold text-white">{saving ? 'Saving…' : 'Add Salary'}</Text>
        </Pressable>
      </View>
    </Overlay>
  );
}
