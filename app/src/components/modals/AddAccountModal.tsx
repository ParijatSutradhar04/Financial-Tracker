import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { AccountInput } from '../../api';
import { toAccountInput } from '../../accounts';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';

interface AddAccountModalProps {
  kind: 'bank' | 'credit_card';
  onClose: () => void;
  onAdd: (input: AccountInput) => Promise<void>;
}

function AmountField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View className="gap-1">
      <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">{label}</Text>
      <View className="flex-row items-center rounded-xl border border-border px-3">
        <Text className="mr-1.5 font-mono text-sm text-muted">₹</Text>
        <TextInput
          className="flex-1 py-3 font-mono text-sm text-ink"
          placeholder="0.00"
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
        />
      </View>
    </View>
  );
}

export function AddAccountModal({ kind, onClose, onAdd }: AddAccountModalProps) {
  const isCard = kind === 'credit_card';
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [limit, setLimit] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const parsed = toAccountInput({ kind, name, amount, limit });
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onAdd(parsed.input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-ink">{isCard ? 'Add Credit Card' : 'Add Account'}</Text>
          <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Name</Text>
          <TextInput
            className="rounded-xl border border-border px-3 py-3 text-sm text-ink"
            placeholder={isCard ? 'e.g. Travel Card' : 'e.g. Savings Account'}
            value={name}
            onChangeText={setName}
            autoFocus
          />
          {!isCard && (
            <Text className="text-[11px] text-muted">
              Add Salary and Transfer act on the accounts named Primary Account and Salary Account.
            </Text>
          )}
        </View>

        <AmountField label={isCard ? 'Outstanding' : 'Amount available'} value={amount} onChange={setAmount} />
        {isCard && <AmountField label="Credit limit (optional)" value={limit} onChange={setLimit} />}

        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}

        <Pressable onPress={submit} disabled={saving} className="rounded-xl bg-accent py-3" style={{ opacity: saving ? 0.5 : 1 }}>
          <Text className="text-center text-sm font-semibold text-white">{saving ? 'Saving…' : isCard ? 'Add Credit Card' : 'Add Account'}</Text>
        </Pressable>
      </View>
    </Overlay>
  );
}
