import { Pressable, Text, View } from 'react-native';
import type { Account } from '../api';
import { fmt } from '../utils';
import { AccountIcon, EyeIcon, accentFor } from './icons';
import { Card } from './Card';

interface AccountCardProps {
  account: Account;
  /** Set only for the salary account, whose figure is masked until asked for. */
  masked?: boolean;
  onToggleMask?: () => void;
}

export function AccountCard({ account, masked, onToggleMask }: AccountCardProps) {
  const color = accentFor(account.role);
  const concealed = masked === true;

  return (
    <Card className="p-6">
      <View className="mb-4 flex-row items-start justify-between">
        <Text className="text-xs font-medium uppercase tracking-widest text-muted">{account.name}</Text>
        <View className="h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: color + '1a' }}>
          <AccountIcon role={account.role} color={color} />
        </View>
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="font-mono text-2xl font-semibold tracking-tight text-ink">
          {concealed ? '••••••' : fmt(account.balance)}
        </Text>
        {onToggleMask && (
          <Pressable onPress={onToggleMask} className="p-0.5">
            <EyeIcon open={!concealed} />
          </Pressable>
        )}
      </View>
      <Text className="mt-1 text-xs text-muted">Available balance</Text>
    </Card>
  );
}
