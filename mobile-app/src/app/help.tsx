import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { useLabels } from '@/lib/hooks';
import { colors, radius, spacing } from '@/theme';
import { MenuRow, Screen, SectionTitle, Text } from '@/ui';

const SUPPORT_PHONE = '+250788000111';
const SUPPORT_EMAIL = 'info@harvesthold.rw';

export default function Help() {
  const { t } = useLabels();
  const [open, setOpen] = useState<number | null>(0);
  const faqs = [1, 2, 3].map((n) => ({ q: t(`help.q${n}`), a: t(`help.a${n}`) }));

  return (
    <Screen header={{}} title={t('help.title')} subtitle={t('help.intro')}>
      <View style={styles.box}>
        <MenuRow icon="phone" label={t('help.call')} value="+250 788 000 111" onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)} />
        <MenuRow icon="mail" label={t('help.email')} value={SUPPORT_EMAIL} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} last />
      </View>
      <Text variant="small" tone="faint" style={{ marginTop: -spacing.sm }}>
        {t('help.hours')}
      </Text>

      <SectionTitle title={t('help.faq')} />
      <View style={styles.box}>
        {faqs.map((f, i) => {
          const expanded = open === i;
          return (
            <View key={i} style={i < faqs.length - 1 && styles.border}>
              <Pressable
                onPress={() => setOpen(expanded ? null : i)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                style={styles.question}
              >
                <Text variant="bodyMedium" style={{ flex: 1 }}>
                  {f.q}
                </Text>
                <Feather name={expanded ? 'minus' : 'plus'} size={18} color={colors.textMuted} />
              </Pressable>
              {expanded && (
                <Text tone="muted" style={styles.answer}>
                  {f.a}
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  question: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  answer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, marginTop: -spacing.xs },
});
