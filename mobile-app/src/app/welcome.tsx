import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LANGUAGES } from '@/i18n';
import { colors, radius, spacing } from '@/theme';
import { Button, Text, type IconName } from '@/ui';

export default function Welcome() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const language = LANGUAGES.find((l) => l.code === i18n.language)?.label ?? 'English';

  const points: { icon: IconName; text: string }[] = [
    { icon: 'thermometer', text: t('welcome.point1') },
    { icon: 'award', text: t('welcome.point2') },
    { icon: 'shopping-bag', text: t('welcome.point3') },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.topRow}>
        <Pressable
          onPress={() => router.push('/language')}
          accessibilityRole="button"
          accessibilityLabel={`${t('welcome.language')}: ${language}`}
          style={({ pressed }) => [styles.language, pressed && { backgroundColor: colors.surface }]}
        >
          <Feather name="globe" size={16} color={colors.textMuted} />
          <Text variant="smallMedium">{language}</Text>
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Image
          source={require('@/assets/images/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Harvest Hold Rwanda"
        />
        <Text variant="title" align="center" style={styles.tagline}>
          {t('welcome.tagline')}
        </Text>
      </View>

      <View style={styles.points}>
        {points.map((p) => (
          <View key={p.icon} style={styles.point}>
            <View style={styles.pointIcon}>
              <Feather name={p.icon} size={18} color={colors.brand} />
            </View>
            <Text style={{ flex: 1 }}>{p.text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Button label={t('welcome.getStarted')} onPress={() => router.push('/role')} testID="get-started" />
        <Button label={t('welcome.haveAccount')} variant="secondary" onPress={() => router.push('/sign-in')} testID="go-sign-in" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl },
  topRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  language: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xl },
  logo: { width: 300, height: Math.round((300 * 398) / 1200) },
  tagline: { maxWidth: 300 },
  points: { gap: spacing.md, marginBottom: spacing.xxl },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { gap: spacing.md },
});
