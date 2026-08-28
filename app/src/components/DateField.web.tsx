import { createElement } from 'react';

interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  maximumDate?: Date;
}

/**
 * @react-native-community/datetimepicker has no web implementation, so the
 * web build falls back to the browser's native <input type="date">,
 * reached via createElement to avoid extending RN's JSX intrinsics.
 */
export function DateField({ value, onChange, maximumDate }: DateFieldProps) {
  return createElement('input', {
    type: 'date',
    value,
    max: maximumDate ? maximumDate.toISOString().slice(0, 10) : undefined,
    onChange: (e: any) => onChange(e.target.value),
    style: {
      fontFamily: 'inherit',
      fontSize: 14,
      color: '#1c1c1e',
      border: '1px solid #e5e5ea',
      borderRadius: 12,
      padding: '11px 12px',
      width: '100%',
      boxSizing: 'border-box',
    },
  });
}
