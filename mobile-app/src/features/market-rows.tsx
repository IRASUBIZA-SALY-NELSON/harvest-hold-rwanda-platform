import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { orderTotal, photoUrl, type ListingView, type OrderView, type Role } from '@/api';
import { formatMoney, formatNumber, formatQuantity, formatRelative, unitName } from '@/i18n/format';
import { freshnessTone, listingTone, orderTone, useLabels } from '@/lib/hooks';
import { colors, radius, spacing } from '@/theme';
import { Badge, Card, CropMark, Text } from '@/ui';

import { CropPhoto } from './photos';

/** Listing as the farmer sees it in "My listings". */
export function MyListingRow({ listing }: { listing: ListingView }) {
  const { t, lang, crop } = useLabels();
  const name = crop(listing.crop);
  return (
    <Card onPress={() => router.push(`/listing/${listing.id}`)} style={styles.row} accessibilityLabel={name} testID={`listing-${listing.id}`}>
      <CropPhoto photoId={listing.photos?.[0]} label={name} muted={listing.status !== 'active'} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="heading" style={{ flex: 1 }} numberOfLines={1}>
            {name}
          </Text>
          {listing.moderation === 'hidden' ? (
            <Badge tone="danger" label={t('market.hiddenTitle')} />
          ) : (
            <Badge tone={listingTone(listing.status)} label={t(`market.status_${listing.status}`)} />
          )}
        </View>
        <Text variant="small" tone="muted">
          {t('common.perUnit', { price: formatNumber(listing.pricePerUnit, lang), unit: unitName(listing.unit, t) })} ·{' '}
          {t('market.available', { quantity: formatQuantity(listing.quantity, listing.unit, t) })}
        </Text>
      </View>
    </Card>
  );
}

/** Listing card in the buyer's browse feed. */
export function BrowseCard({ listing }: { listing: ListingView }) {
  const { t, lang, crop } = useLabels();
  const name = crop(listing.crop);
  const cover = listing.photos?.[0];
  const count = listing.photos?.length ?? 0;
  return (
    <Card onPress={() => router.push(`/listing/${listing.id}`)} style={{ gap: spacing.md }} accessibilityLabel={name} testID={`browse-${listing.id}`}>
      {cover && (
        <View style={styles.cover}>
          <Image source={photoUrl(cover)} placeholder={photoUrl(cover, 'thumb')} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          {count > 1 && (
            <View style={styles.coverCount}>
              <Text variant="caption" style={{ color: colors.white }}>
                1 / {count}
              </Text>
            </View>
          )}
        </View>
      )}
      <View style={styles.row}>
        {!cover && <CropMark label={name} size={48} />}
        <View style={styles.body}>
          <Text variant="heading" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="small" tone="muted" numberOfLines={1}>
            {t('browse.from', { name: listing.farmer.name })} · {listing.coldRoom.district}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="heading">{formatNumber(listing.pricePerUnit, lang)}</Text>
          <Text variant="small" tone="muted">
            RWF / {unitName(listing.unit, t)}
          </Text>
        </View>
      </View>
      <View style={styles.meta}>
        <Badge tone={freshnessTone(listing.freshness)} label={t(`freshness.${listing.freshness}`)} />
        <Text variant="small" tone="muted" style={{ marginLeft: 'auto' }} numberOfLines={1}>
          {t('market.available', { quantity: formatQuantity(listing.quantity, listing.unit, t) })}
        </Text>
      </View>
    </Card>
  );
}

export function OrderRow({ order, viewer }: { order: OrderView; viewer: Role }) {
  const { t, lang, crop } = useLabels();
  const name = crop(order.crop);
  const other = viewer === 'farmer' ? (order.buyer.businessName ?? order.buyer.name) : order.farmer.name;
  return (
    <Card onPress={() => router.push(`/order/${order.id}`)} style={styles.row} accessibilityLabel={`${name}, ${other}`} testID={`order-${order.id}`}>
      <CropMark label={name} muted={order.status === 'declined' || order.status === 'cancelled'} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="heading" style={{ flex: 1 }} numberOfLines={1}>
            {name} · {formatQuantity(order.quantity, order.unit, t)}
          </Text>
        </View>
        <Text variant="small" tone="muted" numberOfLines={1}>
          {other} · {formatRelative(order.createdAt, t)}
        </Text>
        <View style={[styles.titleRow, { marginTop: 4 }]}>
          <Badge tone={orderTone(order.status)} label={t(`orders.status_${order.status}`)} />
          <Text variant="bodyMedium" style={{ marginLeft: 'auto' }}>
            {formatMoney(orderTotal(order), t, lang)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  body: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cover: { height: 168, marginTop: -spacing.xs, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  coverCount: { position: 'absolute', right: 8, bottom: 8, backgroundColor: 'rgba(17,26,20,0.6)', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
});
