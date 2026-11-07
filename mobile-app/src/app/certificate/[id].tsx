import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { getCertificate, issueCertificate } from '@/api';
import { shareCertificate, verifyUrl } from '@/features/certificate-pdf';
import { certificateResult } from '@/features/freshness';
import { PhotoStrip } from '@/features/photos';
import { formatDateTime, formatDuration, formatQuantity, formatTemp } from '@/i18n/format';
import { useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { colors, radius, spacing } from '@/theme';
import { Button, EmptyState, ErrorState, InfoRow, Loading, Screen, Text, useToast } from '@/ui';

export default function CertificateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang, crop, errorMessage } = useLabels();
  const user = useUser();
  const toast = useToast();
  const cert = useApi(() => getCertificate(id), [id]);
  const [sharing, setSharing] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const issue = async () => {
    setIssuing(true);
    try {
      await issueCertificate(id);
      toast(t('certificate.issuedNew'));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setIssuing(false);
    }
  };

  if (cert.loading) return <Screen header={{ title: t('certificate.title') }}><Loading /></Screen>;
  if (cert.data === undefined) {
    return (
      <Screen header={{ title: t('certificate.title') }}>
        <ErrorState message={errorMessage(cert.error)} retryLabel={t('common.retry')} onRetry={cert.refresh} />
      </Screen>
    );
  }
  if (cert.data === null) {
    const farmer = user.role === 'farmer';
    return (
      <Screen
        header={{ title: t('certificate.title') }}
        footer={farmer ? <Button label={t('certificate.issue')} icon="award" onPress={issue} loading={issuing} testID="issue-certificate" /> : undefined}
      >
        <EmptyState icon="award" title={t('certificate.noneTitle')} body={t(farmer ? 'certificate.noneBodyFarmer' : 'certificate.noneBodyBuyer')} />
      </Screen>
    );
  }

  const c = cert.data;
  const result = c.conditions.freshness;
  const owner = c.batch.farmerId === user.id;

  const share = async () => {
    setSharing(true);
    try {
      await shareCertificate(c, t, lang);
    } catch {
      toast(t('certificate.shareError'), 'error');
    } finally {
      setSharing(false);
    }
  };

  return (
    <Screen
      header={{ title: t('certificate.title') }}
      footer={
        <View style={{ gap: spacing.sm }}>
          <Button label={t('certificate.share')} icon="share" onPress={share} loading={sharing} testID="share-certificate" />
          {owner && c.batch.status === 'stored' && (
            <Button label={t('certificate.issueNew')} variant="secondary" onPress={issue} loading={issuing} testID="issue-certificate" />
          )}
        </View>
      }
    >
      <View style={styles.sheet}>
        <Image source={require('@/assets/images/logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Harvest Hold Rwanda" />

        <View style={{ gap: 4 }}>
          <Text variant="title">{t('certificate.heading')}</Text>
          <Text variant="small" tone="muted">
            {t('certificate.number')} {c.id} · {t('certificate.issued', { date: formatDateTime(c.issuedAt, lang) })}
          </Text>
        </View>

        <View>
          <InfoRow label={t('certificate.farmer')} value={c.farmer.name} />
          <InfoRow label={t('certificate.product')} value={`${crop(c.batch.crop)} · ${formatQuantity(c.batch.quantity, c.batch.unit, t)}`} />
          <InfoRow label={t('certificate.coldRoom')} value={`${c.coldRoom.name}, ${c.coldRoom.district}`} />
          <InfoRow label={t('certificate.storedSince')} value={formatDateTime(c.batch.storedAt, lang)} />
          <InfoRow label={t('certificate.duration')} value={formatDuration(c.conditions.hoursStored, t)} />
          <InfoRow
            label={t('certificate.safeRange')}
            value={`${c.conditions.safeMin}–${c.conditions.safeMax}°C · ${c.conditions.humidityMin}–${c.conditions.humidityMax}%`}
          />
          <InfoRow label={t('certificate.avgTemp')} value={formatTemp(c.conditions.avgTemp, lang)} />
          <InfoRow
            label={t('certificate.tempRange')}
            value={`${formatTemp(c.conditions.minTemp, lang)} – ${formatTemp(c.conditions.maxTemp, lang)}`}
          />
          <InfoRow label={t('certificate.avgHumidity')} value={c.conditions.avgHumidity === null ? '–' : `${c.conditions.avgHumidity}%`} />
          <InfoRow label={t('certificate.noData')} value={t('certificate.minutes', { count: c.conditions.minutesNoData })} last />
        </View>

        {c.photos && c.photos.length > 0 && (
          <View style={{ gap: spacing.sm }}>
            <Text variant="caption" tone="muted" style={{ textTransform: 'uppercase' }}>
              {t('certificate.photos')}
            </Text>
            <PhotoStrip ids={c.photos} />
          </View>
        )}

        <View style={[styles.result, result === 'fresh' ? styles.resultFresh : result === 'unknown' ? styles.resultUnknown : styles.resultAttention]}>
          <Feather
            name={result === 'fresh' ? 'check-circle' : result === 'unknown' ? 'help-circle' : 'alert-triangle'}
            size={20}
            color={result === 'fresh' ? colors.brand : result === 'unknown' ? colors.textMuted : colors.warning}
          />
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="muted" style={{ textTransform: 'uppercase' }}>
              {t('certificate.result')}
            </Text>
            <Text variant="bodyMedium" tone={result === 'fresh' ? 'brand' : result === 'unknown' ? 'muted' : 'warning'}>
              {certificateResult(c.conditions, t)}
            </Text>
          </View>
        </View>

        <View style={styles.qrRow}>
          <View style={styles.qr}>
            <QRCode value={verifyUrl(c.id)} size={88} color={colors.text} backgroundColor={colors.white} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="smallMedium">{t('certificate.scan')}</Text>
            <Text variant="small" tone="muted">
              {t('certificate.issuedBy')}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.note}>
        <Feather name="info" size={16} color={colors.textMuted} />
        <Text variant="small" tone="muted" style={{ flex: 1 }}>
          {t('certificate.fixedNote')} {t('certificate.internal')}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl - 4,
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  logo: { width: 150, height: 150 * (398 / 1200) },
  result: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md + 2, borderRadius: radius.md },
  resultFresh: { backgroundColor: colors.brandSoft },
  resultAttention: { backgroundColor: colors.warningSoft },
  resultUnknown: { backgroundColor: colors.surface },
  qrRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  qr: { padding: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  note: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', paddingHorizontal: spacing.xs },
});
