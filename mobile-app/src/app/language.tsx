import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { setLanguage as saveLanguageForAccount } from '@/api';
import { LANGUAGES, setLanguage } from '@/i18n';
import { useAuth } from '@/state/auth';
import { colors, radius, spacing } from '@/theme';
import { Screen, Text } from '@/ui';

export default function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();

  return (
    <Screen header={{}} title={t('language.title')} subtitle={t('language.subtitle')}>
      <View style={styles.list}>
        {LANGUAGES.map((l, i) => {
          const selected = i18n.language === l.code;
          return (
            <Pressable
              key={l.code}
              testID={`lang-${l.code}`}
              onPress={async () => {
                await setLanguage(l.code);
                // SMS and push notifications use the account's language.
                if (user) saveLanguageForAccount(l.code).catch(() => {});
                if (router.canGoBack()) router.back();
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.row,
                i < LANGUAGES.length - 1 && styles.border,
                pressed && { backgroundColor: colors.surface },
              ]}
            >
              <Text variant={selected ? 'bodyMedium' : 'body'} style={{ flex: 1 }}>
                {l.label}
              </Text>
              <View style={[styles.radio, selected && styles.radioOn]}>
                {selected && <Feather name="check" size={14} color={colors.white} />}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden', marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingHorizontal: spacing.lg },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.brand, borderColor: colors.brand },
});
