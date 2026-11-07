import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError, placeOrder, type ListingView, type Order } from '@/api';
import { formatMoney, formatQuantity, unitName } from '@/i18n/format';
import { useLabels } from '@/lib/hooks';
import { colors, radius, spacing } from '@/theme';
import { Button, Field, Text } from '@/ui';

interface Props {
  listing: ListingView;
  buyerId: string;
  visible: boolean;
  onClose: () => void;
  onPlaced: (order: Order) => void;
}

export function OrderSheet({ listing, buyerId, visible, onClose, onPlaced }: Props) {
  const insets = useSafeAreaInsets();
  const { t, lang, crop, errorMessage } = useLabels();
  const step = listing.unit === 'kg' ? 10 : 1;
  const initial = Math.min(step, listing.quantity);
  const [quantity, setQuantity] = useState(initial);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const max = listing.quantity;
  const change = (delta: number) => setQuantity((q) => Math.min(max, Math.max(1, q + delta)));

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const order = await placeOrder(buyerId, { listingId: listing.id, quantity, note });
      setNote('');
      setQuantity(initial);
      onPlaced(order);
    } catch (e) {
      setError(e instanceof ApiError ? errorMessage(e) : t('errors.unknown'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text variant="title">{t('listing.orderTitle')}</Text>
              <Text variant="small" tone="muted">
                {crop(listing.crop)} · {listing.farmer.name}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
              <Feather name="x" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={{ gap: spacing.sm }}>
            <Text variant="smallMedium">{t('listing.quantity')}</Text>
            <View style={styles.stepper}>
              <StepButton icon="minus" onPress={() => change(-step)} disabled={quantity <= 1} label="-" />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text variant="title" testID="order-quantity">
                  {formatQuantity(quantity, listing.unit, t)}
                </Text>
                <Text variant="small" tone="faint">
                  {t('market.maxQuantity', { quantity: formatQuantity(max, listing.unit, t) })}
                </Text>
              </View>
              <StepButton icon="plus" onPress={() => change(step)} disabled={quantity >= max} label="+" />
            </View>
          </View>

          <Field
            label={`${t('listing.note')} (${t('common.optional').toLowerCase()})`}
            value={note}
            onChangeText={setNote}
            placeholder={t('listing.notePlaceholder')}
            maxLength={200}
          />

          <View style={styles.total}>
            <Text tone="muted">
              {t('market.total')} · {formatMoney(listing.pricePerUnit, t, lang)} / {unitName(listing.unit, t)}
            </Text>
            <Text variant="title">{formatMoney(quantity * listing.pricePerUnit, t, lang)}</Text>
          </View>

          {error && <Text tone="danger">{error}</Text>}
          <Button label={t('listing.send')} onPress={submit} loading={busy} testID="send-order" />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StepButton({ icon, onPress, disabled, label }: { icon: 'plus' | 'minus'; onPress: () => void; disabled: boolean; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.step, pressed && { backgroundColor: colors.surface }, disabled && { opacity: 0.35 }]}
    >
      <Feather name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(17, 26, 20, 0.35)' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    paddingHorizontal: spacing.xl - 4,
    paddingTop: spacing.sm,
    gap: spacing.lg,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  step: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
