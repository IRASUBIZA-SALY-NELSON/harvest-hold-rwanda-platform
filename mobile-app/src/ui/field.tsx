import Feather from '@expo/vector-icons/Feather';
import { forwardRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';

import { colors, fonts, radius, spacing } from '@/theme';

import { Text } from './text';

interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  suffix?: ReactNode;
}

export const Field = forwardRef<TextInputInstance, FieldProps>(function Field({ label, hint, error, suffix, style, ...rest }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text variant="smallMedium">{label}</Text>
      <View
        style={[
          styles.box,
          focused && { borderColor: colors.brand },
          !!error && { borderColor: colors.danger },
        ]}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.brand}
          accessibilityLabel={label}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, style]}
        />
        {suffix}
      </View>
      {error ? (
        <Text variant="small" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" tone="faint">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

/** Looks like a field, opens a picker when pressed. */
export function SelectField({
  label,
  value,
  placeholder,
  onPress,
  error,
  testID,
}: {
  label: string;
  value?: string | null;
  placeholder: string;
  onPress: () => void;
  error?: string | null;
  testID?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text variant="smallMedium">{label}</Text>
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        style={({ pressed }) => [styles.box, pressed && { backgroundColor: colors.surface }, !!error && { borderColor: colors.danger }]}
      >
        <Text style={{ flex: 1 }} tone={value ? 'default' : 'faint'} numberOfLines={1}>
          {value ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
      {error && (
        <Text variant="small" tone="danger">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm - 2 },
  box: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg - 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.white,
  },
  input: {
    flex: 1,
    minHeight: 50,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 0,
    outlineStyle: 'none' as never,
  },
});
