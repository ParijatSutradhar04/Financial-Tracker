import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Account } from '../../api';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';

interface ReconcileModalProps {
  accounts: Account[];
  onClose: () => void;
  onReconcile: (balances: { accountId: string; balance: number }[]) => Promise<void>;
}

/**
 * A card holds a negative balance for money owed, which is the right convention
 * for the ledger and the wrong one to type into a form, so cards are shown and
 * read back as the outstanding amount and flipped on the way in and out.
 */
const asShown = (account: Account) => (account.kind === 'credit_card' ? -account.balance : account.balance);

const asStored = (account: Account, shown: number) => (account.kind === 'credit_card' ? -shown : shown);

export function ReconcileModal({ accounts, onClose, onReconcile }: ReconcileModalProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(accounts.map(a => [a.id, asShown(a).toFixed(2)])),
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError('');
    try {
      await onReconcile(
        accounts.map(a => ({
          accountId: a.id,
          balance: asStored(a, parseFloat(values[a.id]) || 0),
        })),
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the balances');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-lg font-semibold text-ink">Reconcile Balance</Text>
            <Text className="mt-0.5 text-xs text-muted">Manually correct account balance discrepancies</Text>
          </View>
          <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        {accounts.map(account => (
          <View key={account.id} className="gap-1">
            <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">
              {account.name} {account.kind === 'credit_card' ? 'Outstanding' : 'Balance'}
            </Text>
            <View className="flex-row items-center rounded-xl border border-border px-3">
              <Text className="mr-1.5 font-mono text-sm text-muted">₹</Text>
              <TextInput
                className="flex-1 py-3 font-mono text-sm text-ink"
                keyboardType="decimal-pad"
                value={values[account.id] ?? ''}
                onChangeText={t => setValues(v => ({ ...v, [account.id]: t }))}
              />
            </View>
          </View>
        ))}

        <Text className="-mt-2 text-xs text-muted">
          Any difference is recorded in the database as an Adjustment, so the ledger keeps adding up.
        </Text>

        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}

        <View className="mt-1 flex-row gap-3">
          <Pressable onPress={onClose} className="flex-1 rounded-xl border border-border py-3">
            <Text className="text-center text-sm font-medium text-ink-secondary">Cancel</Text>
          </Pressable>
          <Pressable onPress={submit} disabled={saving} className="flex-1 rounded-xl bg-ink py-3" style={{ opacity: saving ? 0.5 : 1 }}>
            <Text className="text-center text-sm font-semibold text-white">{saving ? 'Updating…' : 'Update Balances'}</Text>
          </Pressable>
        </View>
      </View>
    </Overlay>
  );
}
