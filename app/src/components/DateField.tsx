import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { fmtDate, isoDate } from '../utils';

interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  maximumDate?: Date;
}

export function DateField({ value, onChange, maximumDate }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const date = new Date(`${value}T00:00:00`);

  return (
    <View>
      <Pressable onPress={() => setOpen(true)} className="rounded-xl border border-border bg-white px-3 py-3">
        <Text className="text-sm text-ink">{fmtDate(value)}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={date}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          maximumDate={maximumDate}
          onChange={(_event, selected) => {
            setOpen(Platform.OS === 'ios');
            if (selected) onChange(isoDate(selected));
          }}
        />
      )}
    </View>
  );
}
