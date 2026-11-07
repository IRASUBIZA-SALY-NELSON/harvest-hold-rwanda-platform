import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

import { Text } from './text';

interface ScreenProps {
  children: ReactNode;
  /** Shown as a simple top bar with a back button. */
  header?: { title?: string; right?: ReactNode; onBack?: () => void } | false;
  /** Big page title for tab roots. */
  title?: string;
  subtitle?: string;
  titleRight?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned to the bottom, above the safe area (e.g. a primary action). */
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Tab screens already get bottom spacing from the tab bar. */
  inTabs?: boolean;
}

export function Screen({
  children,
  header,
  title,
  subtitle,
  titleRight,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  contentStyle,
  inTabs,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  const body = (
    <>
      {title && (
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text variant="display" accessibilityRole="header">
              {title}
            </Text>
            {subtitle && (
              <Text tone="muted" style={{ marginTop: spacing.xs }}>
                {subtitle}
              </Text>
            )}
          </View>
          {titleRight}
        </View>
      )}
      {children}
    </>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {header && <TopBar {...header} />}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              { paddingBottom: footer ? spacing.xl : inTabs ? spacing.xl : insets.bottom + spacing.xl },
              contentStyle,
            ]}
            refreshControl={
              onRefresh ? (
                <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brand} colors={[colors.brand]} />
              ) : undefined
            }
          >
            {body}
          </ScrollView>
        ) : (
          <View style={[styles.content, { flex: 1 }, contentStyle]}>{body}</View>
        )}
        {footer && <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>{footer}</View>}
      </KeyboardAvoidingView>
    </View>
  );
}

export function TopBar({ title, right, onBack }: { title?: string; right?: ReactNode; onBack?: () => void }) {
  const { t } = useTranslation();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={back}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        hitSlop={12}
        style={({ pressed }) => [styles.backButton, pressed && { backgroundColor: colors.surface }]}
      >
        <Feather name="arrow-left" size={22} color={colors.text} />
      </Pressable>
      <Text variant="heading" numberOfLines={1} style={styles.topBarTitle}>
        {title}
      </Text>
      <View style={styles.topBarRight}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.xl - 4, paddingTop: spacing.sm, gap: spacing.lg },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  topBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { flex: 1, textAlign: 'center' },
  topBarRight: { minWidth: 40, alignItems: 'flex-end', paddingRight: spacing.sm },
  footer: {
    paddingHorizontal: spacing.xl - 4,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
});
