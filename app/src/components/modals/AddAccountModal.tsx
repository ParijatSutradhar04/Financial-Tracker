import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';

interface AddAccountModalProps {
  kind: 'bank' | 'credit_card';
  onClose: () => void;
  onAdd: (input: { name: string; kind: 'bank' | 'credit_card'; openingBalance: number }) => Promise<void>;
}

export function AddAccountModal({ kind, onClose, onAdd }: AddAccountModalProps) {
  const isCard = kind === 'credit_card';
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setError('Enter a name');
      return;
    }
    const n = amount.trim() ? parseFloat(amount) : 0;
    if (Number.isNaN(n) || n < 0) {
      setError('Enter a valid amount');
      return;
    }

    setSaving(true);
    setError('');
    try {
      // Outstanding is what's owed on the card, stored as a negative balance;
      // AccountOut derives outstanding = -balance on the way back out.
      await onAdd({ name: name.trim(), kind, openingBalance: isCard ? -n : n });
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
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">
            {isCard ? 'Outstanding' : 'Amount available'}
          </Text>
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

        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}

        <Pressable onPress={submit} disabled={saving} className="rounded-xl bg-accent py-3" style={{ opacity: saving ? 0.5 : 1 }}>
          <Text className="text-center text-sm font-semibold text-white">{saving ? 'Saving…' : isCard ? 'Add Credit Card' : 'Add Account'}</Text>
        </Pressable>
      </View>
    </Overlay>
  );
}
