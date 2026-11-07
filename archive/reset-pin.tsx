import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { requestCode } from '@/api';
import { useLabels } from '@/lib/hooks';
import { useAuth } from '@/state/auth';
import { spacing } from '@/theme';
import { Button, Field, Screen, Text } from '@/ui';

/** Forgotten PIN: prove the phone number with an SMS code, then choose a new PIN. */
export default function ResetPin() {
  const { t, i18n } = useTranslation();
  const { errorMessage } = useLabels();
  const { resetPin } = useAuth();
  const [phone, setPhone] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digits = (v: string, n: number) => v.replace(/\D/g, '').slice(0, n);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      await requestCode(phone, 'resetPin', i18n.language);
      setCodeSent(true);
    });

  const save = () => {
    if (pin !== confirmPin) return;
    run(async () => {
      await resetPin(phone, code, pin);
      router.dismissAll();
      router.replace('/');
    });
  };

  return (
    <Screen
      header={{}}
      title={t('auth.resetTitle')}
      subtitle={t(codeSent ? 'auth.resetSubtitleCode' : 'auth.resetSubtitle')}
      footer={
        codeSent ? (
          <Button label={t('auth.saveNewPin')} onPress={save} loading={busy} disabled={code.length !== 6 || pin.length !== 4} testID="save-pin" />
        ) : (
          <Button label={t('auth.sendCode')} onPress={sendCode} loading={busy} disabled={!phone} testID="send-code" />
        )
      }
    >
      <View style={{ gap: spacing.lg, marginTop: spacing.sm }}>
        <Field
          label={t('auth.phone')}
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            setCodeSent(false);
          }}
          placeholder={t('auth.phonePlaceholder')}
          keyboardType="phone-pad"
          autoComplete="tel"
          testID="phone"
        />
        {codeSent && (
          <>
            <Field
              label={t('auth.code')}
              value={code}
              onChangeText={(v) => setCode(digits(v, 6))}
              placeholder="000000"
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
              testID="code"
            />
            <Field
              label={t('auth.newPin')}
              value={pin}
              onChangeText={(v) => setPin(digits(v, 4))}
              placeholder="••••"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              testID="pin"
            />
            <Field
              label={t('auth.confirmPin')}
              value={confirmPin}
              onChangeText={(v) => setConfirmPin(digits(v, 4))}
              placeholder="••••"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              error={confirmPin.length === 4 && pin !== confirmPin ? t('auth.pinMismatch') : null}
              testID="confirm-pin"
            />
          </>
        )}
        {error && <Text tone="danger">{error}</Text>}
      </View>
    </Screen>
  );
}
