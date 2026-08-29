import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Category } from '../../api';
import { CloseIcon } from '../icons';
import { Overlay } from '../Overlay';

interface CategoryFormModalProps {
  category?: Category;
  onClose: () => void;
  onSave: (input: { name: string; icon: string; color: string }) => Promise<void>;
}

const DEFAULT_COLOR = '#5b5cf6';

export function CategoryFormModal({ category, onClose, onSave }: CategoryFormModalProps) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '📦');
  const [color, setColor] = useState(category?.color ?? DEFAULT_COLOR);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) {
      setError('Enter a name');
      return;
    }
    if (!icon.trim()) {
      setError('Enter an icon');
      return;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color.trim())) {
      setError('Colour must look like #5b5cf6');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await onSave({ name: name.trim(), icon: icon.trim(), color: color.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the category');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <View className="gap-5">
        <View className="flex-row items-center justify-between">
          <Text className="text-lg font-semibold text-ink">{category ? 'Edit Category' : 'Add Category'}</Text>
          <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
            <CloseIcon />
          </Pressable>
        </View>

        <View className="gap-1">
          <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Name</Text>
          <TextInput
            className="rounded-xl border border-border px-3 py-3 text-sm text-ink"
            placeholder="e.g. Groceries"
            value={name}
            onChangeText={setName}
            autoFocus
          />
        </View>

        <View className="flex-row gap-4">
          <View className="flex-1 gap-1">
            <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Icon</Text>
            <TextInput
              className="rounded-xl border border-border px-3 py-3 text-sm text-ink"
              placeholder="📦"
              value={icon}
              onChangeText={setIcon}
              maxLength={10}
            />
          </View>
          <View className="flex-1 gap-1">
            <Text className="text-xs font-medium uppercase tracking-widest text-ink-secondary">Colour</Text>
            <View className="flex-row items-center gap-2 rounded-xl border border-border px-3">
              <View className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : 'transparent' }} />
              <TextInput
                className="flex-1 py-3 font-mono text-sm text-ink"
                placeholder="#5b5cf6"
                value={color}
                onChangeText={setColor}
                autoCapitalize="none"
                maxLength={7}
              />
            </View>
          </View>
        </View>

        {error && <Text className="-mt-2 text-xs text-red">{error}</Text>}

        <Pressable onPress={submit} disabled={saving} className="rounded-xl bg-accent py-3" style={{ opacity: saving ? 0.5 : 1 }}>
          <Text className="text-center text-sm font-semibold text-white">{saving ? 'Saving…' : category ? 'Save Changes' : 'Add Category'}</Text>
        </Pressable>
      </View>
    </Overlay>
  );
}
