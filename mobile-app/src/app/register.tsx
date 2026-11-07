import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError, listColdRooms, type BusinessType, type Lang, type Role } from '@/api';
import { BUSINESS_TYPES, DISTRICTS } from '@/api/constants';
import { useLabels } from '@/lib/hooks';
import { useAuth } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { spacing } from '@/theme';
import { Button, Field, PickerSheet, Screen, SelectField, Text } from '@/ui';

type FieldKey = 'name' | 'phone' | 'district' | 'coldRoom' | 'business' | 'pin' | 'confirm';

const ERROR_FIELD: Record<string, FieldKey> = {
  nameRequired: 'name',
  invalidPhone: 'phone',
  phoneTaken: 'phone',
  districtRequired: 'district',
  coldRoomRequired: 'coldRoom',
  businessRequired: 'business',
  invalidPin: 'pin',
  pinTooSimple: 'pin',
};

export default function Register() {
  const { t, i18n } = useTranslation();
  const { errorMessage } = useLabels();
  const { register } = useAuth();
  const params = useLocalSearchParams<{ role?: string }>();
  const role: Role = params.role === 'buyer' ? 'buyer' : 'farmer';

  const rooms = useApi(listColdRooms, []);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [district, setDistrict] = useState<string | null>(null);
  const [coldRoomId, setColdRoomId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('hotel');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');

  const [picker, setPicker] = useState<'district' | 'room' | 'business' | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const room = rooms.data?.find((r) => r.id === coldRoomId);
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

  const showError = (e: unknown) => {
    const field = e instanceof ApiError ? ERROR_FIELD[e.code] : undefined;
    if (field) setErrors({ [field]: errorMessage(e) });
    else setFormError(errorMessage(e));
  };

  const submit = async () => {
    setErrors({});
    setFormError(null);
    if (pin !== confirmPin) {
      setErrors({ confirm: t('auth.pinMismatch') });
      return;
    }
    setBusy(true);
    try {
      await register({
        role,
        name,
        phone,
        pin,
        lang: i18n.language as Lang,
        district: district ?? '',
        coldRoomId: coldRoomId ?? undefined,
        businessName,
        businessType,
      });
      router.dismissAll();
      router.replace('/');
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={{}}
      title={t(role === 'farmer' ? 'auth.registerTitleFarmer' : 'auth.registerTitleBuyer')}
      subtitle={t('auth.registerSubtitle')}
      footer={<Button label={t('auth.register')} onPress={submit} loading={busy} testID="register" />}
    >
      <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
        <Field
          label={t('auth.fullName')}
          value={name}
          onChangeText={setName}
          placeholder={t('auth.fullNamePlaceholder')}
          autoCapitalize="words"
          autoComplete="name"
          error={errors.name}
          testID="name"
        />
        <Field
          label={t('auth.phone')}
          value={phone}
          onChangeText={setPhone}
          placeholder={t('auth.phonePlaceholder')}
          keyboardType="phone-pad"
          autoComplete="tel"
          error={errors.phone}
          testID="phone"
        />
        <SelectField
          label={t('auth.district')}
          value={district}
          placeholder={t('auth.chooseDistrict')}
          onPress={() => setPicker('district')}
          error={errors.district}
          testID="district"
        />
        {role === 'farmer' ? (
          <SelectField
            label={t('auth.coldRoom')}
            value={room ? `${room.name} · ${room.district}` : null}
            placeholder={t('auth.chooseColdRoom')}
            onPress={() => setPicker('room')}
            error={errors.coldRoom}
            testID="cold-room"
          />
        ) : (
          <>
            <Field
              label={t('auth.businessName')}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder={t('auth.businessNamePlaceholder')}
              autoCapitalize="words"
              error={errors.business}
              testID="business-name"
            />
            <SelectField
              label={t('auth.businessType')}
              value={t(`business.${businessType}`)}
              placeholder={t('auth.businessType')}
              onPress={() => setPicker('business')}
            />
          </>
        )}
        <Field
          label={t('auth.createPin')}
          value={pin}
          onChangeText={(v) => setPin(digits(v))}
          placeholder="••••"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          error={errors.pin}
          testID="pin"
        />
        <Field
          label={t('auth.confirmPin')}
          value={confirmPin}
          onChangeText={(v) => setConfirmPin(digits(v))}
          placeholder="••••"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          error={errors.confirm}
          testID="confirm-pin"
        />
        {formError && <Text tone="danger">{formError}</Text>}
      </View>

      <PickerSheet
        visible={picker === 'district'}
        title={t('auth.district')}
        value={district}
        options={DISTRICTS.map((d) => ({ value: d, label: d }))}
        onSelect={setDistrict}
        onClose={() => setPicker(null)}
        searchPlaceholder={t('auth.chooseDistrict')}
      />
      <PickerSheet
        visible={picker === 'room'}
        title={t('auth.coldRoom')}
        value={coldRoomId}
        options={(rooms.data ?? []).map((r) => ({
          value: r.id,
          label: r.name,
          description: t('coldRoom.location', { sector: r.sector, district: r.district }),
        }))}
        onSelect={setColdRoomId}
        onClose={() => setPicker(null)}
      />
      <PickerSheet
        visible={picker === 'business'}
        title={t('auth.businessType')}
        value={businessType}
        options={BUSINESS_TYPES.map((b) => ({ value: b, label: t(`business.${b}`) }))}
        onSelect={setBusinessType}
        onClose={() => setPicker(null)}
      />
    </Screen>
  );
}
