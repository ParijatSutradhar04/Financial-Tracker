import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronDownIcon } from './icons';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  groups?: SelectGroup[];
  options?: SelectOption[];
}

/**
 * RN has no native <select>, and a platform picker looks and behaves
 * differently on every target, so this is a small custom dropdown instead —
 * a pressable field that opens a modal list, built once and shared by the
 * two pickers in Add Expense (paid-with, category).
 */
export function Select({ value, onChange, groups, options }: SelectProps) {
  const [open, setOpen] = useState(false);
  const all = options ?? (groups ?? []).flatMap(g => g.options);
  const label = all.find(o => o.value === value)?.label ?? '';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-xl border border-border bg-white px-3 py-3"
      >
        <Text className="text-sm text-ink">{label}</Text>
        <ChevronDownIcon />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          className="flex-1 items-center justify-center px-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          onPress={() => setOpen(false)}
        >
          <Pressable className="max-h-[70%] w-full max-w-md rounded-2xl bg-white p-2" onPress={() => {}}>
            <ScrollView>
              {groups
                ? groups.map(group => (
                    <View key={group.label}>
                      <Text className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted">
                        {group.label}
                      </Text>
                      {group.options.map(option => (
                        <Row
                          key={option.value}
                          option={option}
                          selected={option.value === value}
                          onPress={() => {
                            onChange(option.value);
                            setOpen(false);
                          }}
                        />
                      ))}
                    </View>
                  ))
                : (options ?? []).map(option => (
                    <Row
                      key={option.value}
                      option={option}
                      selected={option.value === value}
                      onPress={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    />
                  ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Row({ option, selected, onPress }: { option: SelectOption; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className={`rounded-xl px-3 py-3 ${selected ? 'bg-accent-light' : ''}`}>
      <Text className={`text-sm ${selected ? 'font-medium text-accent' : 'text-ink'}`}>{option.label}</Text>
    </Pressable>
  );
}
