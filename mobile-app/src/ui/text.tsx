import { Text as RNText, type TextProps } from 'react-native';

import { colors, type, type TypeVariant } from '@/theme';

const tones = {
  default: colors.text,
  muted: colors.textMuted,
  faint: colors.textFaint,
  brand: colors.brand,
  warning: colors.warning,
  danger: colors.danger,
  inverse: colors.white,
} as const;

export type Tone = keyof typeof tones;

interface Props extends TextProps {
  variant?: TypeVariant;
  tone?: Tone;
  align?: 'left' | 'center' | 'right';
}

export function Text({ variant = 'body', tone = 'default', align, style, ...rest }: Props) {
  return (
    <RNText
      {...rest}
      style={[type[variant], { color: tones[tone] }, align && { textAlign: align }, style]}
      maxFontSizeMultiplier={1.4}
    />
  );
}
