// Mostly white UI. Brand green from the logo is the only accent; orange is reserved for warnings.
export const colors = {
  background: '#FFFFFF',
  surface: '#F7F8F7',
  border: '#E8EBE8',
  borderStrong: '#D5DAD5',

  text: '#111A14',
  textMuted: '#5E6B62',
  textFaint: '#8E9991',

  brand: '#0B5A2B',
  brandSoft: '#EEF5F0',
  leaf: '#3A9A44',

  warning: '#C2410C',
  warningSoft: '#FFF4EC',
  danger: '#B42318',
  dangerSoft: '#FEF1F0',

  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const type = {
  display: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  title: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  smallMedium: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14, letterSpacing: 0.6 },
  metric: { fontFamily: fonts.semibold, fontSize: 40, lineHeight: 46, letterSpacing: -1.2 },
} as const;

export type TypeVariant = keyof typeof type;
