import type { ReactNode } from 'react';
import { Modal, Pressable } from 'react-native';

/** Backdrop + centered sheet shared by all four write-flow modals. */
export function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 items-center justify-center px-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
        onPress={onClose}
      >
        <Pressable className="w-full max-w-md rounded-2xl bg-white p-6" onPress={() => {}}>
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
