import { Text, View } from 'react-native';
import type { Transaction } from '../api';
import { MONTH_NAMES, fmt } from '../utils';

export function SparkbarChart({ transactions }: { transactions: Transaction[] }) {
  const today = new Date();

  const months = Array.from({ length: 5 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - (4 - i), 1);
    return { year: d.getFullYear(), month: d.getMonth(), label: MONTH_NAMES[d.getMonth()].slice(0, 3) };
  });

  const totals = months.map(m =>
    transactions
      .filter(t => {
        const d = new Date(`${t.date}T00:00:00`);
        return t.isSpend && d.getFullYear() === m.year && d.getMonth() === m.month;
      })
      .reduce((s, t) => s + t.amount, 0),
  );

  const peak = Math.max(...totals, 1);

  return (
    <View className="h-20 w-full flex-row items-end gap-2">
      {months.map((m, i) => {
        const pct = totals[i] / peak;
        const isCurrentMonth = m.year === today.getFullYear() && m.month === today.getMonth();
        return (
          <View key={i} className="flex-1 items-center gap-1.5">
            <View className="w-full items-end justify-end" style={{ height: 60 }}>
              <View
                className="w-full rounded-t-lg"
                style={{
                  height: `${Math.max(pct * 100, 4)}%`,
                  backgroundColor: isCurrentMonth ? '#5b5cf6' : '#e5e5e7',
                }}
              />
            </View>
            <Text className="text-[10px] font-medium" style={{ color: isCurrentMonth ? '#5b5cf6' : '#8e8e93' }}>
              {m.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
