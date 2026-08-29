import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Category } from '../../api';
import { CloseIcon, EditIcon, PlusIcon, TrashIcon } from '../icons';
import { Overlay } from '../Overlay';
import { CategoryFormModal } from './CategoryFormModal';

interface ManageCategoriesModalProps {
  categories: Category[];
  onClose: () => void;
  onAdd: (input: { name: string; icon: string; color: string }) => Promise<void>;
  onEdit: (id: string, input: { name: string; icon: string; color: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function ManageCategoriesModal({ categories, onClose, onAdd, onEdit, onDelete }: ManageCategoriesModalProps) {
  const [formFor, setFormFor] = useState<Category | 'new' | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function handleDelete(category: Category) {
    if (!category.id) return;
    setDeletingId(category.id);
    setError('');
    try {
      await onDelete(category.id);
      setConfirmingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the category');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <Overlay onClose={onClose}>
        <View className="gap-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-ink">Categories</Text>
            <Pressable onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full">
              <CloseIcon />
            </Pressable>
          </View>

          <Pressable onPress={() => setFormFor('new')} className="flex-row items-center justify-center gap-1.5 rounded-xl bg-accent py-3">
            <PlusIcon />
            <Text className="text-sm font-semibold text-white">Add category</Text>
          </Pressable>

          {error && <Text className="text-xs text-red">{error}</Text>}

          <ScrollView className="max-h-96">
            <View className="gap-2">
              {categories.map(category => (
                <View key={category.id ?? category.name} className="flex-row items-center justify-between rounded-xl border border-border px-3 py-2.5">
                  <View className="flex-row items-center gap-2.5">
                    <View className="h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: category.color + '15' }}>
                      <Text className="text-sm">{category.icon}</Text>
                    </View>
                    <Text className="text-sm font-medium text-ink">{category.name}</Text>
                  </View>

                  {category.id && (
                    <View className="flex-row items-center gap-2">
                      {confirmingId === category.id ? (
                        <>
                          <Pressable
                            onPress={() => handleDelete(category)}
                            disabled={deletingId === category.id}
                            className="rounded-lg bg-red/10 px-2 py-1.5"
                          >
                            <Text className="text-xs font-semibold text-red">{deletingId === category.id ? '…' : 'Confirm'}</Text>
                          </Pressable>
                          <Pressable onPress={() => setConfirmingId(null)} className="rounded-lg px-2 py-1.5">
                            <Text className="text-xs font-medium text-muted">Cancel</Text>
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable onPress={() => setFormFor(category)} className="h-7 w-7 items-center justify-center rounded-lg border border-border">
                            <EditIcon />
                          </Pressable>
                          <Pressable onPress={() => setConfirmingId(category.id!)} className="h-7 w-7 items-center justify-center rounded-lg border border-border">
                            <TrashIcon />
                          </Pressable>
                        </>
                      )}
                    </View>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </Overlay>

      {formFor && (
        <CategoryFormModal
          category={formFor === 'new' ? undefined : formFor}
          onClose={() => setFormFor(null)}
          onSave={async input => {
            if (formFor === 'new') {
              await onAdd(input);
            } else {
              await onEdit(formFor.id!, input);
            }
          }}
        />
      )}
    </>
  );
}
