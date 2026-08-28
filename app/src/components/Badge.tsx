import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

export function Badge({ children, color = '#5b5cf6' }: { children: ReactNode; color?: string }) {
  return (
    <View
      className="flex-row items-center gap-1 self-start rounded-full px-2.5 py-1"
      style={{ backgroundColor: color + '18', borderWidth: 1, borderColor: color + '30' }}
    >
      <Text className="text-xs font-semibold tracking-wide" style={{ color }}>
        {children}
      </Text>
    </View>
  );
}
