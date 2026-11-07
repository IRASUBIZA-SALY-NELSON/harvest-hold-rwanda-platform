import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ApiError, createListing, listStock } from '@/api';
import { PhotoEditor, usePhotoQueue } from '@/features/photos';
import { formatQuantity, unitName } from '@/i18n/format';
import { freshnessTone, useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { colors, radius, spacing } from '@/theme';
import { Badge, Button, CropMark, EmptyState, Field, Loading, Screen, SectionTitle, Text, useToast } from '@/ui';

export default function NewListing() {
  const user = useUser();
  const params = useLocalSearchParams<{ batch?: string }>();
  const { t, crop, errorMessage } = useLabels();
  const toast = useToast();
  const stock = useApi(() => listStock(user.id), [user.id]);
  const [batchId, setBatchId] = useState<string | null>(params.batch ?? null);
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<{ quantity?: string; price?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const photos = usePhotoQueue('listing', undefined);

  // Only crops still in the cold room and not already on the market can be listed.
  const sellable = stock.data?.filter((s) => s.batch.status === 'stored' && (!s.listing || s.listing.status === 'soldOut')) ?? [];
  const selected = sellable.find((s) => s.batch.id === batchId) ?? null;

  // Coming from a stock page: pre-fill the full quantity once stock has loaded.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !params.batch || !selected) return;
    prefilled.current = true;
    setQuantity(String(selected.batch.quantity));
  }, [params.batch, selected]);

  const choose = (id: string) => {
    setBatchId(id);
    const item = sellable.find((s) => s.batch.id === id);
    if (item) setQuantity(String(item.batch.quantity));
    setErrors({});
  };

  const submit = async () => {
    if (!selected) return;
    setErrors({});
    setBusy(true);
    try {
      const listing = await createListing(user.id, {
        batchId: selected.batch.id,
        quantity: Number(quantity),
        pricePerUnit: Number(price),
      });
      const failed = await photos.uploadAll(listing.id);
      toast(failed ? t('photos.someFailed', { n: failed }) : t('market.published'), failed ? 'error' : undefined);
      router.replace(`/listing/${listing.id}`);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'invalidQuantity' || code === 'moreThanStock') setErrors({ quantity: errorMessage(e) });
      else if (code === 'invalidPrice') setErrors({ price: errorMessage(e) });
      else setErrors({ form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={{}}
      title={t('market.newListing')}
      footer={
        sellable.length > 0 ? (
          <Button label={t('market.publish')} onPress={submit} loading={busy} disabled={!selected || !quantity || !price} testID="publish" />
        ) : undefined
      }
    >
      {stock.loading ? (
        <Loading />
      ) : sellable.length === 0 ? (
        <EmptyState
          icon="package"
          title={t('stock.empty')}
          body={t('market.noStockToSell')}
          action={{ label: t('stock.add'), icon: 'plus', onPress: () => router.replace('/stock/new') }}
        />
      ) : (
        <>
          <SectionTitle title={t('market.pickStock')} />
          <View style={styles.list}>
            {sellable.map((s, i) => {
              const active = s.batch.id === batchId;
              return (
                <Pressable
                  key={s.batch.id}
                  testID={`pick-${s.batch.id}`}
                  onPress={() => choose(s.batch.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.option,
                    i < sellable.length - 1 && styles.border,
                    (pressed || active) && { backgroundColor: active ? colors.brandSoft : colors.surface },
                  ]}
                >
                  <CropMark label={crop(s.batch.crop)} size={40} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="bodyMedium">{crop(s.batch.crop)}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Text variant="small" tone="muted">
                        {formatQuantity(s.batch.quantity, s.batch.unit, t)}
                      </Text>
                      <Badge tone={freshnessTone(s.conditions.freshness)} label={t(`freshness.${s.conditions.freshness}`)} />
                    </View>
                  </View>
                  <View style={[styles.radio, active && styles.radioOn]}>
                    {active && <Feather name="check" size={14} color={colors.white} />}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {selected && (
            <View style={{ gap: spacing.lg }}>
              <Field
                label={t('market.quantityToSell')}
                value={quantity}
                onChangeText={(v) => setQuantity(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                hint={t('market.maxQuantity', { quantity: formatQuantity(selected.batch.quantity, selected.batch.unit, t) })}
                error={errors.quantity}
                suffix={<Text tone="muted">{unitName(selected.batch.unit, t)}</Text>}
                testID="listing-quantity"
              />
              <Field
                label={t('market.price', { unit: unitName(selected.batch.unit, t) })}
                value={price}
                onChangeText={(v) => setPrice(v.replace(/\D/g, '').slice(0, 8))}
                keyboardType="number-pad"
                placeholder={t('market.pricePlaceholder')}
                error={errors.price}
                suffix={<Text tone="muted">RWF</Text>}
                testID="listing-price"
              />
              <PhotoEditor queue={photos} max={4} hint={t('photos.listingHint')} testID="listing-photos" />
              {errors.form && <Text tone="danger">{errors.form}</Text>}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md + 2 },
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
