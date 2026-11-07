import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { cancelStorageRequest, getCharges, listStock, listStorageRequests } from '@/api';
import { StockRow } from '@/features/stock-row';
import { formatMoney, formatQuantity } from '@/i18n/format';
import { useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { spacing } from '@/theme';
import { Badge, Button, Card, confirm, EmptyState, ErrorState, InfoRow, Loading, Screen, SectionTitle, Text, useToast } from '@/ui';

export default function StockScreen() {
  const user = useUser();
  const { t, lang, crop, errorMessage } = useLabels();
  const toast = useToast();
  const stock = useApi(() => listStock(user.id), [user.id]);
  const charges = useApi(() => getCharges(), [user.id]);
  const requests = useApi(() => listStorageRequests(), [user.id]);

  const stored = stock.data?.filter((s) => s.batch.status === 'stored') ?? [];
  const removed = stock.data?.filter((s) => s.batch.status === 'removed') ?? [];
  const goAdd = () => router.push('/stock/new');
  // Requests still waiting, and answers received in the last week (older ones are in the stock itself).
  const [openedAt] = useState(() => Date.now());
  const week = openedAt - 7 * 86_400_000;
  const shownRequests = (requests.data ?? []).filter((r) => r.status === 'pending' || (r.status !== 'cancelled' && r.handledAt && Date.parse(r.handledAt) > week && r.status === 'declined'));
  const cancel = async (id: string) => {
    const ok = await confirm({ title: t('stock.reqCancel'), message: t('stock.reqCancelConfirm'), confirmLabel: t('stock.reqCancel'), cancelLabel: t('common.cancel'), destructive: true });
    if (!ok) return;
    try {
      await cancelStorageRequest(id);
      toast(t('stock.reqCancelled2'));
      requests.refresh();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <Screen
      inTabs
      title={t('stock.title')}
      subtitle={t('stock.subtitle')}
      titleRight={stock.data?.length || shownRequests.length ? <Button label={t('stock.add')} icon="plus" size="sm" onPress={goAdd} testID="add-stock" /> : undefined}
      refreshing={stock.refreshing}
      onRefresh={() => {
        stock.refresh();
        charges.refresh();
        requests.refresh();
      }}
    >
      {stock.loading ? (
        <Loading />
      ) : stock.error ? (
        <ErrorState message={t('common.somethingWrong')} retryLabel={t('common.retry')} onRetry={stock.refresh} />
      ) : !stock.data?.length && !shownRequests.length ? (
        <EmptyState
          icon="package"
          title={t('stock.empty')}
          body={t('stock.emptyBody')}
          action={{ label: t('stock.add'), icon: 'plus', onPress: goAdd }}
        />
      ) : (
        <>
          {shownRequests.length > 0 && (
            <View style={{ gap: spacing.md }}>
              <SectionTitle title={t('stock.requestsTitle')} />
              {shownRequests.map((r) => (
                <Card key={r.id} style={{ gap: spacing.xs }} testID={`request-${r.id}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Text variant="heading" style={{ flex: 1 }}>{crop(r.crop)}</Text>
                    <Badge tone={r.status === 'pending' ? 'warning' : 'danger'} label={r.status === 'pending' ? t('stock.reqPending') : t('stock.reqDeclined', { reason: r.declineReason ?? '' })} dot={false} />
                  </View>
                  <Text variant="small" tone="muted">{t('stock.reqAskedAbout', { quantity: formatQuantity(r.estimatedQuantity, r.unit, t) })}</Text>
                  {r.status === 'pending' && <Button label={t('stock.reqCancel')} variant="secondary" size="sm" onPress={() => cancel(r.id)} />}
                </Card>
              ))}
            </View>
          )}
          {charges.data?.rateSet && charges.data.totalRwf > 0 && (
            <Card style={{ paddingVertical: spacing.xs }}>
              <InfoRow label={t('stock.chargesTotalDue')} value={formatMoney(charges.data.dueRwf, t, lang)} last />
            </Card>
          )}
          {stored.length > 0 && (
            <View style={{ gap: spacing.md }}>
              <SectionTitle title={t('stock.inColdRoom')} />
              {stored.map((s) => (
                <StockRow key={s.batch.id} item={s} />
              ))}
            </View>
          )}
          {removed.length > 0 && (
            <View style={{ gap: spacing.md }}>
              <SectionTitle title={t('stock.collectionCollected')} />
              {removed.map((s) => (
                <StockRow key={s.batch.id} item={s} />
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
