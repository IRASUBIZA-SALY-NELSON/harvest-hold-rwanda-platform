import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { StockItem } from '@/api';
import { formatDate, formatDuration, formatQuantity } from '@/i18n/format';
import { freshnessTone, useLabels } from '@/lib/hooks';
import { colors, spacing } from '@/theme';
import { Badge, Card, Text } from '@/ui';

import { CropPhoto } from './photos';

export function StockRow({ item }: { item: StockItem }) {
  const { t, lang, crop } = useLabels();
  const { batch, conditions, listing } = item;
  const stored = batch.status === 'stored';
  const name = crop(batch.crop);

  return (
    <Card
      onPress={() => router.push(`/stock/${batch.id}`)}
      accessibilityLabel={`${name}, ${formatQuantity(batch.quantity, batch.unit, t)}`}
      testID={`stock-${batch.id}`}
      style={styles.card}
    >
      <CropPhoto photoId={batch.photos?.[0]} label={name} muted={!stored} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="heading" style={{ flex: 1 }} numberOfLines={1} tone={stored ? 'default' : 'muted'}>
            {name}
          </Text>
          <Text variant="bodyMedium" tone={stored ? 'default' : 'muted'}>
            {formatQuantity(batch.quantity, batch.unit, t)}
          </Text>
        </View>
        <Text variant="small" tone="muted">
          {stored
            ? t('time.storedFor', { duration: formatDuration(conditions.hoursStored, t) })
            : t('stock.storedOn', { date: formatDate(batch.storedAt, lang) })}
          {batch.code ? `  ·  ${batch.code}` : ''}
        </Text>
        {stored && (
          <View style={styles.badges}>
            <Badge tone={freshnessTone(conditions.freshness)} label={t(`freshness.${conditions.freshness}`)} />
            {listing?.status === 'active' && <Badge tone="neutral" dot={false} label={t('stock.listed')} />}
            {batch.collectionStatus === 'requested' && <Badge tone="warning" dot={false} label={t('stock.collectionRequested')} />}
          </View>
        )}
      </View>
      <Feather name="chevron-right" size={18} color={colors.textFaint} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, marginTop: 4 },
});
