import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { RESET_WORD, isResetConfirmed } from '../../accounts';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';

interface ResetModalProps {
  accountCount: number;
  onClose: () => void;
  /** Resolves once the reset has gone through and the dashboard has reloaded. */
  onReset: (confirm: string) => Promise<void>;
}

/** Confirmation screen for wiping the ledger. Nothing is sent until the word is typed. */
export function ResetModal({ accountCount, onClose, onReset }: ResetModalProps) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmed = isResetConfirmed(typed);

  async function submit() {
    if (!confirmed) return;
    setBusy(true);
    setError('');
    try {
      await onReset(typed.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={busy ? () => {} : onClose}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-ink">Reset everything?</Text>
          <Pressable onPress={onClose} disabled={busy} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        <View className="gap-2 rounded-xl border border-red/25 bg-red/[0.08] px-4 py-3">
          <Text className="text-sm font-semibold text-red">This can't be undone.</Text>
          <Text className="text-xs text-ink-secondary">
            Deletes all {accountCount} account{accountCount === 1 ? '' : 's'} and credit card{accountCount === 1 ? '' : 's'}, every
            transaction, and the record of which Splitwise expenses were imported.
          </Text>
          <Text className="text-xs text-ink-secondary">
            Your categories and remembered Splitwise categories stay. You'll add your accounts again with their current
            balances.
          </Text>
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Type {RESET_WORD} to confirm</Text>
          <TextInput
            className="rounded-xl border border-border px-3 py-3 font-mono text-sm text-ink"
            placeholder={RESET_WORD}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
        </View>

        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}

        <View className="flex-row gap-3">
          <Pressable onPress={onClose} disabled={busy} className="flex-1 rounded-xl border border-border py-3">
            <Text className="text-center text-sm font-semibold text-ink-secondary">Cancel</Text>
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={!confirmed || busy}
            className="flex-1 rounded-xl py-3"
            style={{ backgroundColor: '#ff3b30', opacity: !confirmed || busy ? 0.4 : 1 }}
          >
            <Text className="text-center text-sm font-semibold text-white">{busy ? 'Resetting…' : 'Delete everything'}</Text>
          </Pressable>
        </View>
      </View>
    </Overlay>
  );
}
