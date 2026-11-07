import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

import { Text } from './text';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: keyof typeof Feather.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  size?: 'md' | 'sm';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const palette: Record<Variant, { bg: string; fg: string; border: string; pressed: string }> = {
  primary: { bg: colors.brand, fg: colors.white, border: colors.brand, pressed: '#08471F' },
  secondary: { bg: colors.white, fg: colors.text, border: colors.borderStrong, pressed: colors.surface },
  ghost: { bg: 'transparent', fg: colors.brand, border: 'transparent', pressed: colors.brandSoft },
  danger: { bg: colors.white, fg: colors.danger, border: colors.border, pressed: colors.dangerSoft },
};

export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, size = 'md', style, testID }: Props) {
  const p = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' && styles.sm,
        { backgroundColor: pressed ? p.pressed : p.bg, borderColor: p.border },
        inactive && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.content}>
          {icon && <Feather name={icon} size={size === 'sm' ? 16 : 18} color={p.fg} />}
          <Text variant={size === 'sm' ? 'smallMedium' : 'bodyMedium'} style={{ color: p.fg }}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  sm: { minHeight: 38, borderRadius: radius.sm, paddingHorizontal: spacing.md },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disabled: { opacity: 0.45 },
});
