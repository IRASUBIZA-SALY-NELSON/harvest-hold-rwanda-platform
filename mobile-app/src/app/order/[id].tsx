import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { cancelOrder, formatPhone, getOrder, orderTotal, respondToOrder } from '@/api';
import { formatDateTime, formatMoney, formatQuantity, unitName } from '@/i18n/format';
import { orderTone, useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { colors, radius, spacing } from '@/theme';
import { Badge, Button, Card, confirm, CropMark, ErrorState, InfoRow, Loading, Screen, SectionTitle, Text, useToast } from '@/ui';

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUser();
  const { t, lang, crop, errorMessage } = useLabels();
  const toast = useToast();
  const order = useApi(() => getOrder(id), [id]);
  const [busy, setBusy] = useState<'accept' | 'decline' | 'cancel' | null>(null);

  if (order.loading) return <Screen header={{ title: t('orders.detail') }}><Loading /></Screen>;
  if (!order.data) {
    return (
      <Screen header={{ title: t('orders.detail') }}>
        <ErrorState message={errorMessage(order.error)} retryLabel={t('common.retry')} onRetry={order.refresh} />
      </Screen>
    );
  }

  const o = order.data;
  const isFarmer = user.id === o.farmerId;
  const other = isFarmer ? o.buyer : o.farmer;
  const otherName = isFarmer ? (o.buyer.businessName ?? o.buyer.name) : o.farmer.name;
  const pending = o.status === 'pending';
  const accepted = o.status === 'accepted';

  const run = async (kind: 'accept' | 'decline' | 'cancel') => {
    if (kind !== 'accept') {
      const ok = await confirm({
        title: t(kind === 'decline' ? 'orders.decline' : 'orders.cancel'),
        confirmLabel: t(kind === 'decline' ? 'orders.decline' : 'orders.cancel'),
        cancelLabel: t('common.back'),
        destructive: true,
      });
      if (!ok) return;
    }
    setBusy(kind);
    try {
      if (kind === 'cancel') await cancelOrder(user.id, o.id);
      else await respondToOrder(user.id, o.id, kind === 'accept');
      toast(t(kind === 'accept' ? 'orders.accepted' : kind === 'decline' ? 'orders.declined' : 'orders.cancelled'));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  const footer = pending ? (
    isFarmer ? (
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Button label={t('orders.decline')} variant="secondary" onPress={() => run('decline')} loading={busy === 'decline'} disabled={!!busy} style={{ flex: 1 }} testID="decline" />
        <Button label={t('orders.accept')} onPress={() => run('accept')} loading={busy === 'accept'} disabled={!!busy} style={{ flex: 2 }} testID="accept" />
      </View>
    ) : (
      <Button label={t('orders.cancel')} variant="danger" onPress={() => run('cancel')} loading={busy === 'cancel'} testID="cancel-order" />
    )
  ) : accepted ? (
    <Button label={`${t('orders.call')} ${otherName}`} icon="phone" onPress={() => Linking.openURL(`tel:${other.phone}`)} />
  ) : undefined;

  return (
    <Screen header={{ title: t('orders.detail') }} footer={footer} refreshing={order.refreshing} onRefresh={order.refresh}>
      <View style={styles.head}>
        <CropMark label={crop(o.crop)} size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title">{crop(o.crop)}</Text>
          <Text variant="small" tone="muted">
            {t('orders.placed', { time: formatDateTime(o.createdAt, lang) })}
          </Text>
        </View>
        <Badge tone={orderTone(o.status)} label={t(`orders.status_${o.status}`)} />
      </View>

      {(pending || accepted) && !isFarmer && (
        <View style={[styles.notice, accepted && { backgroundColor: colors.brandSoft }]}>
          <Feather name={accepted ? 'check-circle' : 'clock'} size={18} color={accepted ? colors.brand : colors.textMuted} />
          <Text variant="small" tone={accepted ? 'brand' : 'muted'} style={{ flex: 1 }}>
            {t(accepted ? 'orders.acceptedBuyer' : 'orders.waitingFarmer')}
          </Text>
        </View>
      )}

      <Card style={{ paddingVertical: spacing.xs }}>
        <InfoRow label={t('orders.quantity')} value={formatQuantity(o.quantity, o.unit, t)} />
        <InfoRow label={t('orders.price')} value={`${formatMoney(o.pricePerUnit, t, lang)} / ${unitName(o.unit, t)}`} />
        <InfoRow label={t('orders.total')} value={<Text variant="heading">{formatMoney(orderTotal(o), t, lang)}</Text>} last />
      </Card>

      <SectionTitle title={t(isFarmer ? 'orders.buyer' : 'orders.farmer')} />
      <Card style={{ paddingVertical: spacing.xs }}>
        <InfoRow label={t(isFarmer ? 'orders.buyer' : 'orders.farmer')} value={otherName} />
        {isFarmer && o.buyer.businessType && <InfoRow label={t('profile.business')} value={t(`business.${o.buyer.businessType}`)} />}
        {accepted && other.phone && <InfoRow label={t('orders.phone')} value={formatPhone(other.phone)} />}
        <InfoRow label={t('orders.pickup')} value={`${o.coldRoom.name}, ${o.coldRoom.district}`} last />
      </Card>

      {!!o.note && (
        <>
          <SectionTitle title={t('orders.note')} />
          <View style={styles.note}>
            <Text>{o.note}</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  note: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
});
