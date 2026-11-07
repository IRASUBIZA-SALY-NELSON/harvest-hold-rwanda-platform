import Feather from '@expo/vector-icons/Feather';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/theme';

import { Text } from './text';

type ToastKind = 'success' | 'error';
type Show = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<Show>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<{ message: string; kind: ToastKind; key: number } | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback<Show>((message, kind = 'success') => {
    setToast({ message, kind, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    clearTimeout(timer.current);
    Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToast(null));
    }, 2600);
    return () => clearTimeout(timer.current);
  }, [toast, opacity]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[styles.toast, { bottom: insets.bottom + 88, opacity }]}
        >
          <Feather
            name={toast.kind === 'success' ? 'check-circle' : 'alert-circle'}
            size={18}
            color={toast.kind === 'success' ? '#7DD89A' : '#FFB4A8'}
          />
          <Text variant="smallMedium" tone="inverse" style={{ flexShrink: 1 }}>
            {toast.message}
          </Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: 420,
    marginHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.text,
  },
});
