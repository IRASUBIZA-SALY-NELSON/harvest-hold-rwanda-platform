import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type TextInputInstance } from 'react-native';

import { ApiError } from '@/api';
import { useLabels } from '@/lib/hooks';
import { useAuth } from '@/state/auth';
import { spacing } from '@/theme';
import { Button, Field, Screen, Text } from '@/ui';

export default function SignIn() {
  const { t } = useTranslation();
  const { errorMessage } = useLabels();
  const { signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Code of the last sign-in error, to show the lock warning or the support link. */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    setError(null);
    setErrorCode(null);
    setBusy(true);
    try {
      await signIn(phone, pin);
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e));
      setErrorCode(e instanceof ApiError ? e.code : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={{}}
      title={t('auth.signInTitle')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          <Button label={t('auth.signIn')} onPress={submit} loading={busy} disabled={!phone || pin.length !== 4} testID="sign-in" />
          <Pressable onPress={() => router.replace('/role')} style={{ alignItems: 'center', paddingVertical: spacing.sm }} hitSlop={8}>
            <Text variant="small" tone="muted">
              {t('auth.noAccount')}{' '}
              <Text variant="smallMedium" tone="brand">
                {t('auth.createAccount')}
              </Text>
            </Text>
          </Pressable>
        </>
      }
    >
      <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
        <Field
          label={t('auth.phone')}
          value={phone}
          onChangeText={setPhone}
          placeholder={t('auth.phonePlaceholder')}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="next"
          onSubmitEditing={() => pinRef.current?.focus()}
          testID="phone"
        />
        <Field
          ref={pinRef}
          label={t('auth.pin')}
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          hint={t('auth.pinHint')}
          error={error}
          onSubmitEditing={submit}
          testID="pin"
        />
        {errorCode === 'wrongCredentials' && (
          <Text variant="small" tone="muted">
            {t('auth.lockWarning')}
          </Text>
        )}
        {errorCode === 'accountLocked' ? (
          <Button label={t('auth.contactSupport')} variant="secondary" icon="phone" onPress={() => router.push('/help')} testID="contact-support" />
        ) : (
          <Pressable onPress={() => router.push('/help')} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
            <Text variant="smallMedium" tone="brand">
              {t('auth.forgotPin')}
            </Text>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}
