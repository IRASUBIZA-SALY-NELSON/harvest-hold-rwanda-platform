import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radius, spacing } from '@/theme';

import { Text } from './text';

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface Props<T extends string> {
  visible: boolean;
  title: string;
  options: PickerOption<T>[];
  value?: T | null;
  onSelect: (value: T) => void;
  onClose: () => void;
  searchPlaceholder?: string;
}

/** Bottom sheet list. Shows a search box automatically for long lists. */
export function PickerSheet<T extends string>({ visible, title, options, value, onSelect, onClose, searchPlaceholder }: Props<T>) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const searchable = options.length > 8;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={title} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text variant="heading" style={{ flex: 1 }}>
            {title}
          </Text>
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
        {searchable && (
          <View style={styles.search}>
            <Feather name="search" size={18} color={colors.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              autoCorrect={false}
            />
          </View>
        )}
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          style={{ maxHeight: 440 }}
          renderItem={({ item }) => {
            const selected = item.value === value;
            return (
              <Pressable
                onPress={() => {
                  onSelect(item.value);
                  close();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.surface }]}
              >
                <View style={{ flex: 1 }}>
                  <Text variant={selected ? 'bodyMedium' : 'body'}>{item.label}</Text>
                  {item.description && (
                    <Text variant="small" tone="muted">
                      {item.description}
                    </Text>
                  )}
                </View>
                {selected && <Feather name="check" size={20} color={colors.brand} />}
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(17, 26, 20, 0.35)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    paddingTop: spacing.sm,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xl - 4, paddingVertical: spacing.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl - 4,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
    outlineStyle: 'none' as never,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.xl - 4,
    paddingVertical: spacing.sm,
  },
});
