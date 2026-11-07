import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Role } from '@/api';
import { colors, radius, spacing } from '@/theme';
import { Screen, Text, type IconName } from '@/ui';

export default function ChooseRole() {
  const { t } = useTranslation();

  const options: { role: Role; icon: IconName; title: string; hint: string }[] = [
    { role: 'farmer', icon: 'sun', title: t('role.farmer'), hint: t('role.farmerHint') },
    { role: 'buyer', icon: 'shopping-bag', title: t('role.buyer'), hint: t('role.buyerHint') },
  ];

  return (
    <Screen header={{}} title={t('role.title')} subtitle={t('role.subtitle')}>
      <View style={{ gap: spacing.md, marginTop: spacing.sm }}>
        {options.map((o) => (
          <Pressable
            key={o.role}
            testID={`role-${o.role}`}
            onPress={() => router.push({ pathname: '/register', params: { role: o.role } })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.option, pressed && { borderColor: colors.brand, backgroundColor: colors.brandSoft }]}
          >
            <View style={styles.icon}>
              <Feather name={o.icon} size={22} color={colors.brand} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading">{o.title}</Text>
              <Text variant="small" tone="muted">
                {o.hint}
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.textFaint} />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
