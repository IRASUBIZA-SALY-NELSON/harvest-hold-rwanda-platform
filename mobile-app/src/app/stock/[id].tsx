import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import QRCode from 'react-native-qrcode-svg';

import { getStockItem, requestCollection } from '@/api';
import { freshnessExplanation } from '@/features/freshness';
import { PhotoEditor, PhotoGallery, usePhotoQueue } from '@/features/photos';
import { formatDate, formatDateTime, formatDuration, formatMoney, formatQuantity, formatTemp, unitName } from '@/i18n/format';
import { listingTone, useLabels } from '@/lib/hooks';
import { useApi } from '@/state/use-api';
import { colors, radius, spacing } from '@/theme';
import { Badge, Button, Card, confirm, CropMark, ErrorState, InfoRow, Loading, Screen, SectionTitle, Text, useToast } from '@/ui';

export default function StockDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang, crop, errorMessage } = useLabels();
  const toast = useToast();
  const item = useApi(() => getStockItem(id), [id]);
  const [busy, setBusy] = useState(false);
  const photos = usePhotoQueue('checkin', id, item.data?.batch.photos);

  if (item.loading) return <Screen header={{ title: t('stock.detail') }}><Loading /></Screen>;
  if (!item.data) {
    return (
      <Screen header={{ title: t('stock.detail') }}>
        <ErrorState message={errorMessage(item.error)} retryLabel={t('common.retry')} onRetry={item.refresh} />
      </Screen>
    );
  }

  const { batch, conditions, listing, coldRoom, charges, history, traceUrl } = item.data;
  const stored = batch.status === 'stored';
  const fresh = conditions.freshness === 'fresh';
  const unknown = conditions.freshness === 'unknown';
  const activeListing = listing && listing.status !== 'soldOut' ? listing : null;

  const askForCollection = async () => {
    const ok = await confirm({
      title: t('stock.requestCollection'),
      message: t('stock.requestCollectionConfirm'),
      confirmLabel: t('stock.requestCollection'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await requestCollection(batch.id);
      toast(t('stock.collectionAsked'));
      item.refresh();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const collection = batch.collectionStatus ?? (stored ? 'stored' : 'collected');
  const money = (n: number) => formatMoney(n, t, lang);
  const reasonLabel = (m: { reason: string; by: string | null }) =>
    m.reason === 'checkin'
      ? t('stock.historyStored')
      : m.reason === 'sale'
        ? t('stock.historySold', { name: m.by ?? '' })
        : m.reason === 'collection'
          ? t('stock.historyCollected', { name: m.by ?? '' })
          : t('stock.historyRemoved');

  return (
    <Screen
      header={{ title: t('stock.detail') }}
      refreshing={item.refreshing}
      onRefresh={item.refresh}
      footer={
        stored ? (
          activeListing ? (
            <Button label={t('stock.viewListing')} variant="secondary" icon="tag" onPress={() => router.push(`/listing/${activeListing.id}`)} />
          ) : (
            <Button label={t('stock.sell')} icon="tag" onPress={() => router.push({ pathname: '/listing/new', params: { batch: batch.id } })} testID="sell" />
          )
        ) : undefined
      }
    >
      <View style={styles.head}>
        <CropMark label={crop(batch.crop)} size={56} muted={!stored} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title">{crop(batch.crop)}</Text>
          <Text tone="muted">{formatQuantity(batch.quantity, batch.unit, t)}</Text>
        </View>
        <Badge
          tone={collection === 'stored' ? 'brand' : collection === 'requested' ? 'warning' : 'neutral'}
          label={t(collection === 'stored' ? 'stock.collectionStored' : collection === 'requested' ? 'stock.collectionRequested' : 'stock.collectionCollected')}
          dot={stored}
        />
      </View>

      <Card style={[styles.freshness, fresh ? styles.fresh : unknown ? styles.unknown : styles.attention]}>
        <Feather
          name={fresh ? 'shield' : unknown ? 'help-circle' : 'alert-triangle'}
          size={22}
          color={fresh ? colors.brand : unknown ? colors.textMuted : colors.warning}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" tone={fresh ? 'brand' : unknown ? 'default' : 'warning'}>
            {t(`freshness.${conditions.freshness}`)}
          </Text>
          <Text variant="small" tone="muted">
            {freshnessExplanation(conditions, t)}
          </Text>
        </View>
      </Card>

      {stored ? (
        <PhotoEditor queue={photos} max={3} hint={t('photos.checkinHint')} testID="checkin-photos" />
      ) : (
        <PhotoGallery ids={batch.photos ?? []} height={200} />
      )}

      <Card style={{ paddingVertical: spacing.xs }}>
        {batch.code ? <InfoRow label={t('stock.batchCode')} value={batch.code} /> : null}
        {batch.harvestDate ? <InfoRow label={t('stock.harvestDate')} value={formatDate(`${batch.harvestDate}T12:00:00`, lang)} /> : null}
        {coldRoom ? <InfoRow label={t('stock.location')} value={`${coldRoom.name}${batch.storageLocation ? `, ${batch.storageLocation}` : ''}`} last /> : null}
      </Card>

      {traceUrl && (
        <Card style={styles.qr}>
          <View style={styles.qrBox}>
            <QRCode value={traceUrl} size={120} color={colors.text} backgroundColor={colors.white} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyMedium">{t('stock.qrTitle')}</Text>
            <Text variant="small" tone="muted">
              {t('stock.qrHint')}
            </Text>
          </View>
        </Card>
      )}

      {charges && (
        <>
          <SectionTitle title={t('stock.chargesTitle')} />
          <Card style={{ paddingVertical: spacing.xs }}>
            {!charges.rateSet ? (
              <View style={{ paddingVertical: spacing.md }}>
                <Text variant="small" tone="muted">
                  {t('stock.chargesNoRate')}
                </Text>
              </View>
            ) : (
              <>
                {stored && charges.rateRwf !== null && (
                  <InfoRow label={t('stock.chargesRunning')} value={money(charges.runningRwf)} />
                )}
                {charges.collectedRwf > 0 && <InfoRow label={t('stock.chargesCollected')} value={money(charges.collectedRwf)} />}
                <InfoRow label={t('stock.chargesDue')} value={money(charges.dueRwf)} last />
              </>
            )}
          </Card>
          {charges.rateSet && stored && charges.rateRwf !== null && (
            <Text variant="small" tone="muted">
              {t('stock.chargesRate', { rate: charges.rateRwf, unit: unitName(batch.unit, t), days: charges.days })}
            </Text>
          )}
        </>
      )}

      <SectionTitle title={t('stock.conditions')} />
      <Card style={{ paddingVertical: spacing.xs }}>
        <InfoRow label={t('certificate.storedSince')} value={formatDateTime(batch.storedAt, lang)} />
        <InfoRow label={t('certificate.duration')} value={formatDuration(conditions.hoursStored, t)} />
        <InfoRow label={t('certificate.avgTemp')} value={formatTemp(conditions.avgTemp, lang)} />
        <InfoRow
          label={t('certificate.tempRange')}
          value={`${formatTemp(conditions.minTemp, lang)} – ${formatTemp(conditions.maxTemp, lang)}`}
        />
        <InfoRow label={t('certificate.avgHumidity')} value={conditions.avgHumidity === null ? '–' : `${conditions.avgHumidity}%`} />
        <InfoRow label={t('certificate.safeRange')} value={`${conditions.safeMin}–${conditions.safeMax}°C · ${conditions.humidityMin}–${conditions.humidityMax}%`} />
        <InfoRow label={t('certificate.noData')} value={t('certificate.minutes', { count: conditions.minutesNoData })} last />
      </Card>

      <Card onPress={() => router.push(`/certificate/${batch.id}`)} style={styles.certRow} testID="open-certificate">
        <View style={styles.certIcon}>
          <Feather name="award" size={20} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium">{t('stock.certificate')}</Text>
          <Text variant="small" tone="muted">
            {t('stock.viewCertificate')}
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.textFaint} />
      </Card>

      {activeListing && (
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium">{t('stock.listed')}</Text>
            <Text variant="small" tone="muted">
              {t('market.available', { quantity: formatQuantity(activeListing.quantity, activeListing.unit, t) })}
            </Text>
          </View>
          <Badge tone={listingTone(activeListing.status)} label={t(`market.status_${activeListing.status}`)} />
        </Card>
      )}

      {history && history.movements.length > 0 && (
        <>
          <SectionTitle title={t('stock.historyTitle')} />
          <Card style={{ paddingVertical: spacing.xs }}>
            {history.movements.map((m, i) => {
              const c = history.collections.find((x) => m.kind === 'out' && x.collectedAt === m.at);
              return (
                <InfoRow
                  key={m.id}
                  label={`${reasonLabel(m)} · ${formatQuantity(m.quantity, m.unit, t)}`}
                  value={
                    c && c.chargeRwf !== null
                      ? `${formatDateTime(m.at, lang)}\n${t('stock.historyCharge', { amount: money(c.chargeRwf), days: c.days })} · ${t(c.paymentStatus === 'paid' ? 'stock.paymentPaid' : c.paymentStatus === 'waived' ? 'stock.paymentWaived' : 'stock.paymentUnpaid')}`
                      : formatDateTime(m.at, lang)
                  }
                  last={i === history.movements.length - 1}
                />
              );
            })}
          </Card>
        </>
      )}

      {stored && collection === 'stored' && <Button label={t('stock.requestCollection')} variant="secondary" icon="truck" onPress={askForCollection} loading={busy} testID="request-collection" />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.sm },
  freshness: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  fresh: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  attention: { backgroundColor: colors.warningSoft, borderColor: colors.warningSoft },
  unknown: { backgroundColor: colors.surface, borderColor: colors.border },
  certRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  qr: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  qrBox: { padding: spacing.sm, backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  certIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
