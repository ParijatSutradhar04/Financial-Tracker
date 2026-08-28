import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & ViewProps) {
  return (
    <View className={`rounded-2xl border border-border bg-card ${className}`} {...rest}>
      {children}
    </View>
  );
}
