import { Text, View } from 'react-native';
import type { Account } from '../api';
import { fmt } from '../utils';
import { CreditCardIcon } from './icons';
import { Card } from './Card';

/**
 * Charges on a card are debits like any other expense, so the ledger balance
 * falls below zero and `outstanding` is what the user actually owes.
 */
export function CreditCardCard({ account }: { account: Account }) {
  const owed = account.outstanding ?? 0;
  const inCredit = owed < 0;

  return (
    <Card className="p-6">
      <View className="mb-4 flex-row items-start justify-between">
        <Text className="text-xs font-medium uppercase tracking-widest text-muted">{account.name}</Text>
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-orange/10">
          <CreditCardIcon />
        </View>
      </View>
      <Text className="font-mono text-2xl font-semibold tracking-tight" style={{ color: owed > 0 ? '#ff3b30' : '#1c1c1e' }}>
        {fmt(Math.abs(owed))}
      </Text>
      <Text className="mt-1 text-xs text-muted">
        {inCredit ? 'Credit on the card' : owed === 0 ? 'Nothing outstanding' : 'Outstanding'}
      </Text>
    </Card>
  );
}
