import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Account } from '../../api';
import { fmt, shortName } from '../../utils';
import { BigArrowRightIcon, CloseIcon } from '../icons';
import { Overlay } from '../Overlay';

interface TransferModalProps {
  from: Account;
  to: Account;
  onClose: () => void;
  onTransfer: (amount: number) => Promise<void>;
}

export function TransferModal({ from, to, onClose, onTransfer }: TransferModalProps) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const n = parseFloat(amount);
    if (!n || n <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (n > from.balance) {
      setError(`Insufficient balance in ${shortName(from.name)} account`);
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onTransfer(n);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the transfer');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-semibold text-ink">Transfer Funds</Text>
            <Text className="mt-0.5 text-xs text-muted">
              {shortName(from.name)} → {shortName(to.name)} Account
            </Text>
          </View>
          <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        <View className="flex-row items-center gap-2 rounded-xl bg-surface px-4 py-3">
          <View className="flex-1 items-center">
            <Text className="mb-0.5 text-[10px] font-medium uppercase tracking-widest text-muted">From</Text>
            <Text className="text-sm font-semibold text-ink">{shortName(from.name)}</Text>
            <Text className="font-mono text-xs text-muted">{fmt(from.balance)}</Text>
          </View>
          <BigArrowRightIcon />
          <View className="flex-1 items-center">
            <Text className="mb-0.5 text-[10px] font-medium uppercase tracking-widest text-muted">To</Text>
            <Text className="text-sm font-semibold text-ink">{shortName(to.name)}</Text>
            <Text className="font-mono text-xs text-muted">{fmt(to.balance)}</Text>
          </View>
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Amount</Text>
          <View className="flex-row items-center rounded-xl border border-border px-3">
            <Text className="mr-1.5 font-mono text-sm text-muted">₹</Text>
            <TextInput
              className="flex-1 py-3 font-mono text-sm text-ink"
              placeholder="0"
              value={amount}
              onChangeText={t => {
                setAmount(t);
                setError('');
              }}
              keyboardType="decimal-pad"
              autoFocus
            />
          </View>
          {error && <Text className="text-xs text-red">{error}</Text>}
        </View>

        <Pressable onPress={submit} disabled={saving} className="rounded-xl bg-accent py-3" style={{ opacity: saving ? 0.5 : 1 }}>
          <Text className="text-center text-sm font-semibold text-white">{saving ? 'Transferring…' : 'Transfer'}</Text>
        </Pressable>
      </View>
    </Overlay>
  );
}
