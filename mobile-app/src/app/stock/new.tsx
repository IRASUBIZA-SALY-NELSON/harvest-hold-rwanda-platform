import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ApiError, getColdRoom, requestStorage, type CropId, type Unit } from '@/api';
import { UNITS } from '@/api/constants';
import { useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { spacing } from '@/theme';
import { Button, Chip, Field, PickerSheet, Screen, SelectField, Text, useToast } from '@/ui';

/** The farmer asks to store produce. The operator at the cold room weighs it and confirms the real quantity. */
export default function RequestStorage() {
  const user = useUser();
  const { t, crop, errorMessage } = useLabels();
  const toast = useToast();
  const [cropId, setCropId] = useState<CropId | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<Unit>('kg');
  const [note, setNote] = useState('');
  const room = useApi(() => getColdRoom(user.coldRoomId ?? ''), [user.coldRoomId]);
  const [pickCrop, setPickCrop] = useState(false);
  const [errors, setErrors] = useState<{ crop?: string; quantity?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!cropId) {
      setErrors({ crop: t('stock.crop') });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await requestStorage({ crop: cropId, quantity: Number(quantity), unit, note: note.trim() || undefined });
      toast(t('stock.added'));
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalidQuantity') setErrors({ quantity: errorMessage(e) });
      else setErrors({ form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={{}}
      title={t('stock.addTitle')}
      subtitle={t('stock.addSubtitle')}
      footer={<Button label={t('stock.add')} onPress={submit} loading={busy} disabled={!cropId || !quantity} testID="save-stock" />}
    >
      <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
        <SelectField
          label={t('stock.crop')}
          value={cropId ? crop(cropId) : null}
          placeholder={t('stock.crop')}
          onPress={() => setPickCrop(true)}
          error={errors.crop ? ' ' : null}
          testID="crop"
        />
        <View style={{ gap: spacing.sm - 2 }}>
          <Text variant="smallMedium">{t('stock.unit')}</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {UNITS.map((u) => (
              <Chip key={u} label={t(u === 'crate' ? 'units.crateName' : 'units.kgName')} active={unit === u} onPress={() => setUnit(u)} />
            ))}
          </View>
        </View>
        <Field
          label={t('stock.quantity')}
          value={quantity}
          onChangeText={(v) => setQuantity(v.replace(/[^\d]/g, '').slice(0, 6))}
          keyboardType="number-pad"
          placeholder="0"
          error={errors.quantity}
          testID="quantity"
        />
        <Field label={t('stock.requestNote')} value={note} onChangeText={(v) => setNote(v.slice(0, 300))} placeholder={t('stock.requestNotePlaceholder')} multiline testID="note" />
        <Text variant="small" tone="muted">
          {t('stock.storedNowNote')}
        </Text>
        {errors.form && <Text tone="danger">{errors.form}</Text>}
      </View>
      <PickerSheet
        visible={pickCrop}
        title={t('stock.crop')}
        value={cropId}
        options={(room.data?.allowedCrops ?? []).map((c) => ({ value: c, label: crop(c) }))}
        onSelect={setCropId}
        onClose={() => setPickCrop(false)}
        searchPlaceholder={t('stock.crop')}
      />
    </Screen>
  );
}
