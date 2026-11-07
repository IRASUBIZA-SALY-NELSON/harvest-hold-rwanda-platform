import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { getListing, ordersForUser, updateListing } from '@/api';
import { OrderRow } from '@/features/market-rows';
import { Avatar, PhotoEditor, PhotoGallery, usePhotoQueue } from '@/features/photos';
import { OrderSheet } from '@/features/order-sheet';
import { formatDate, formatNumber, formatQuantity, unitName } from '@/i18n/format';
import { listingTone, useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { colors, radius, spacing } from '@/theme';
import { Badge, Button, Card, CropMark, ErrorState, InfoRow, Loading, Screen, SectionTitle, Text, useToast } from '@/ui';

export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useUser();
  const { t, lang, crop, errorMessage } = useLabels();
  const toast = useToast();
  const listing = useApi(() => getListing(id), [id]);
  const orders = useApi(() => ordersForUser(user), [user.id]);
  const [ordering, setOrdering] = useState(false);
  const [busy, setBusy] = useState(false);
  const photos = usePhotoQueue('listing', id, listing.data?.photos);

  if (listing.loading) return <Screen header={{ title: t('market.listingTitle') }}><Loading /></Screen>;
  if (!listing.data) {
    return (
      <Screen header={{ title: t('market.listingTitle') }}>
        <ErrorState message={errorMessage(listing.error)} retryLabel={t('common.retry')} onRetry={listing.refresh} />
      </Screen>
    );
  }

  const l = listing.data;
  const isOwner = l.farmerId === user.id;
  const hidden = l.moderation === 'hidden';
  const name = crop(l.crop);
  const listingOrders = orders.data?.filter((o) => o.listingId === l.id) ?? [];

  const setStatus = async (status: 'active' | 'paused') => {
    setBusy(true);
    try {
      await updateListing(user.id, l.id, { status });
      toast(t(status === 'paused' ? 'market.paused' : 'market.resumed'));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const footer = isOwner ? (
    l.status === 'soldOut' || hidden ? undefined : (
      <Button
        label={t(l.status === 'active' ? 'market.pause' : 'market.resume')}
        variant={l.status === 'active' ? 'secondary' : 'primary'}
        icon={l.status === 'active' ? 'pause' : 'play'}
        loading={busy}
        onPress={() => setStatus(l.status === 'active' ? 'paused' : 'active')}
        testID="toggle-listing"
      />
    )
  ) : user.role === 'buyer' && l.status === 'active' ? (
    <Button label={t('listing.order')} icon="shopping-bag" onPress={() => setOrdering(true)} testID="order" />
  ) : undefined;

  return (
    <Screen header={{ title: t('market.listingTitle') }} footer={footer} refreshing={listing.refreshing} onRefresh={listing.refresh}>
      {hidden && (
        <View style={styles.hidden} testID="listing-hidden">
          <Feather name="eye-off" size={20} color={colors.danger} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="heading" tone="danger">
              {t('market.hiddenTitle')}
            </Text>
            <Text variant="small" tone="muted">
              {t('market.hiddenBody')}
            </Text>
            {l.moderationReason ? <Text variant="smallMedium">{t('market.hiddenReason', { reason: l.moderationReason })}</Text> : null}
          </View>
        </View>
      )}

      {!isOwner && <PhotoGallery ids={l.photos ?? []} testID="listing-gallery" />}

      <View style={styles.hero}>
        {(isOwner || !l.photos?.length) && <CropMark label={name} size={64} />}
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title">{name}</Text>
          <Text tone="muted">{t('market.available', { quantity: formatQuantity(l.quantity, l.unit, t) })}</Text>
        </View>
      </View>

      <Card style={styles.priceCard}>
        <View>
          <Text variant="display">{formatNumber(l.pricePerUnit, lang)}</Text>
          <Text tone="muted">RWF / {unitName(l.unit, t)}</Text>
        </View>
        <Badge tone={listingTone(l.status)} label={t(`market.status_${l.status}`)} />
      </Card>

      {!isOwner && l.status !== 'active' && (
        <Text tone="warning" align="center">
          {t('listing.unavailable')}
        </Text>
      )}

      <Card
        onPress={() => router.push(`/certificate/${l.batchId}`)}
        style={[
          styles.fresh,
          { backgroundColor: l.freshness === 'fresh' ? colors.brandSoft : l.freshness === 'unknown' ? colors.surface : colors.warningSoft },
        ]}
        testID="listing-certificate"
      >
        <Feather
          name={l.freshness === 'fresh' ? 'shield' : l.freshness === 'unknown' ? 'help-circle' : 'alert-triangle'}
          size={22}
          color={l.freshness === 'fresh' ? colors.brand : l.freshness === 'unknown' ? colors.textMuted : colors.warning}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading" tone={l.freshness === 'fresh' ? 'brand' : l.freshness === 'unknown' ? 'default' : 'warning'}>
            {t(`freshness.${l.freshness}`)}
          </Text>
          <Text variant="small" tone="muted">
            {t('listing.certificate')}
          </Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.textMuted} />
      </Card>

      {isOwner && l.status !== 'soldOut' && <PhotoEditor queue={photos} max={4} hint={t('photos.listingHint')} testID="listing-photos" />}

      <SectionTitle title={t('listing.seller')} />
      <Card style={{ paddingVertical: spacing.xs }}>
        <View style={styles.seller}>
          <Avatar name={l.farmer.name} photoId={l.farmer.photoId} size={44} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium">{l.farmer.name}</Text>
            <Text variant="small" tone="muted">
              {l.farmer.district}
            </Text>
          </View>
        </View>
        <InfoRow label={t('listing.location')} value={l.coldRoom.name} />
        <InfoRow label={t('browse.district')} value={`${l.coldRoom.sector}, ${l.coldRoom.district}`} />
        <InfoRow label={t('listing.listedOn')} value={formatDate(l.createdAt, lang)} last />
      </Card>

      {!isOwner && l.contact && (
        <Button
          label={t('listing.callSeller', { name: l.contact.name })}
          variant="secondary"
          icon="phone"
          onPress={() => Linking.openURL(`tel:${l.contact!.phone}`).catch(() => toast(t('common.somethingWrong'), 'error'))}
          testID="call-seller"
        />
      )}

      {isOwner && (
        <>
          <SectionTitle title={t('market.orders')} />
          {listingOrders.length === 0 ? (
            <View style={styles.emptyOrders}>
              <Text variant="small" tone="muted" align="center">
                {t('market.noOrdersBody')}
              </Text>
            </View>
          ) : (
            listingOrders.map((o) => <OrderRow key={o.id} order={o} viewer="farmer" />)
          )}
        </>
      )}

      {!isOwner && user.role === 'buyer' && (
        <OrderSheet
          listing={l}
          buyerId={user.id}
          visible={ordering}
          onClose={() => setOrdering(false)}
          onPlaced={(order) => {
            setOrdering(false);
            toast(t('listing.sent'));
            router.push(`/order/${order.id}`);
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingTop: spacing.sm },
  priceCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  fresh: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderColor: 'transparent' },
  seller: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  hidden: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.dangerSoft },
  emptyOrders: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
});
