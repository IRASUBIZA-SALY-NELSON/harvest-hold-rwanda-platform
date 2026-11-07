import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { Button } from './button';
import { Text } from './text';

export type IconName = keyof typeof Feather.glyphMap;

export function Card({
  children,
  style,
  onPress,
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, pressed && { backgroundColor: colors.surface }, style]}
    >
      {children}
    </Pressable>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.sectionTitle}>
      <Text variant="caption" tone="muted" style={{ textTransform: 'uppercase' }}>
        {title}
      </Text>
      {action && (
        <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
          <Text variant="smallMedium" tone="brand">
            {action.label}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export type BadgeTone = 'brand' | 'warning' | 'neutral' | 'danger';

const badgeTones: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  brand: { bg: colors.brandSoft, fg: colors.brand, dot: colors.leaf },
  warning: { bg: colors.warningSoft, fg: colors.warning, dot: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger, dot: colors.danger },
  neutral: { bg: colors.surface, fg: colors.textMuted, dot: colors.textFaint },
};

export function Badge({ label, tone = 'neutral', dot = true }: { label: string; tone?: BadgeTone; dot?: boolean }) {
  const c = badgeTones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      {dot && <View style={[styles.dot, { backgroundColor: c.dot }]} />}
      <Text variant="smallMedium" style={{ color: c.fg }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/** Label on the left, value on the right. */
export function InfoRow({ label, value, last }: { label: string; value: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text tone="muted" style={{ flexShrink: 0, maxWidth: '50%' }}>
        {label}
      </Text>
      {typeof value === 'string' ? (
        <Text variant="bodyMedium" align="right" style={{ flex: 1 }}>
          {value}
        </Text>
      ) : (
        <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>{value}</View>
      )}
    </View>
  );
}

/** Tappable row used in menus and settings. */
export function MenuRow({
  icon,
  label,
  value,
  onPress,
  tone = 'default',
  last,
}: {
  icon: IconName;
  label: string;
  value?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  last?: boolean;
}) {
  const color = tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.surface }]}
    >
      <Feather name={icon} size={20} color={tone === 'danger' ? colors.danger : colors.textMuted} />
      <View style={[styles.menuRowBody, !last && styles.infoRowBorder]}>
        <Text style={{ flex: 1, color }}>{label}</Text>
        {value && (
          <Text tone="muted" variant="small">
            {value}
          </Text>
        )}
        {tone !== 'danger' && <Feather name="chevron-right" size={18} color={colors.textFaint} />}
      </View>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={24} color={colors.brand} />
      </View>
      <Text variant="heading" align="center">
        {title}
      </Text>
      {body && (
        <Text tone="muted" align="center" style={{ maxWidth: 300 }}>
          {body}
        </Text>
      )}
      {action && <Button label={action.label} icon={action.icon} onPress={action.onPress} style={{ marginTop: spacing.sm, alignSelf: 'stretch' }} />}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

export function ErrorState({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.dangerSoft }]}>
        <Feather name="wifi-off" size={22} color={colors.danger} />
      </View>
      <Text tone="muted" align="center">
        {message}
      </Text>
      <Button label={retryLabel} variant="secondary" size="sm" onPress={onRetry} />
    </View>
  );
}

/** Small rounded mark with the crop's initials — calmer than emoji or stock photos. */
export function CropMark({ label, size = 44, muted }: { label: string; size?: number; muted?: boolean }) {
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: muted ? colors.surface : colors.brandSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant="smallMedium" style={{ color: muted ? colors.textFaint : colors.brand, fontSize: size * 0.32 }}>
        {initials}
      </Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text variant="smallMedium" tone={active ? 'default' : 'muted'}>
              {o.label}
            </Text>
            {!!o.badge && (
              <View style={styles.segmentBadge}>
                <Text variant="caption" tone="inverse" style={{ letterSpacing: 0 }}>
                  {o.badge}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: colors.text, borderColor: colors.text },
        pressed && !active && { backgroundColor: colors.surface },
      ]}
    >
      {icon && <Feather name={icon} size={14} color={active ? colors.white : colors.textMuted} />}
      <Text variant="smallMedium" tone={active ? 'inverse' : 'default'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  sectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: -spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  infoRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingLeft: spacing.lg },
  menuRowBody: {
    flex: 1,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl * 2 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.sm + 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  segmentActive: {
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
  },
});
