import Feather from '@expo/vector-icons/Feather';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { deletePhoto, formatPhone, getColdRoom, uploadPhoto } from '@/api';
import { LANGUAGES } from '@/i18n';
import { formatDate } from '@/i18n/format';
import { useLabels } from '@/lib/hooks';
import { useAuth, useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { colors, radius, spacing } from '@/theme';
import { Badge, Card, confirm, InfoRow, MenuRow, Screen, SectionTitle, Text, useToast } from '@/ui';

import { Avatar, usePickPhoto } from './photos';

export function ProfileScreen() {
  const user = useUser();
  const { signOut, refreshUser } = useAuth();
  const { t, lang, errorMessage } = useLabels();
  const toast = useToast();
  const pickPhoto = usePickPhoto();
  const [photoBusy, setPhotoBusy] = useState(false);
  const room = useApi(() => (user.coldRoomId ? getColdRoom(user.coldRoomId) : Promise.resolve(null)), [user.coldRoomId]);

  const changePhoto = async () => {
    const uri = await pickPhoto({ square: true });
    if (!uri) return;
    setPhotoBusy(true);
    try {
      await uploadPhoto('profile', uri);
      await refreshUser();
      toast(t('photos.profileUpdated'));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    if (!user.photoId) return;
    const ok = await confirm({ title: t('photos.removeConfirm'), confirmLabel: t('photos.remove'), cancelLabel: t('common.cancel'), destructive: true });
    if (!ok) return;
    setPhotoBusy(true);
    try {
      await deletePhoto(user.photoId);
      await refreshUser();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const languageLabel = LANGUAGES.find((l) => l.code === lang)?.label;

  const doSignOut = async () => {
    const ok = await confirm({
      title: t('profile.signOutConfirm'),
      confirmLabel: t('profile.signOut'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    await signOut();
    router.replace('/welcome');
  };

  return (
    <Screen inTabs title={t('profile.title')}>
      <View style={styles.identity}>
        <Pressable onPress={changePhoto} disabled={photoBusy} accessibilityRole="button" accessibilityLabel={t('photos.change')} testID="profile-photo">
          <Avatar name={user.name} photoId={user.photoId} size={72} />
          <View style={styles.cameraBadge}>
            {photoBusy ? <ActivityIndicator size="small" color={colors.white} /> : <Feather name="camera" size={13} color={colors.white} />}
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title">{user.name}</Text>
          <Badge tone="brand" label={t(user.role === 'farmer' ? 'profile.farmer' : 'profile.buyer')} dot={false} />
        </View>
      </View>

      <SectionTitle title={t('profile.account')} />
      <Card style={{ paddingVertical: spacing.xs }}>
        <InfoRow label={t('profile.phone')} value={user.phone ? formatPhone(user.phone) : '—'} />
        <InfoRow label={t('profile.district')} value={user.district} />
        {user.role === 'farmer' ? (
          <InfoRow label={t('profile.coldRoom')} value={room.data?.name ?? '—'} last />
        ) : (
          <InfoRow
            label={t('profile.business')}
            value={`${user.businessName ?? ''}${user.businessType ? ` · ${t(`business.${user.businessType}`)}` : ''}`}
            last
          />
        )}
      </Card>
      <Text variant="small" tone="faint" style={{ marginTop: -spacing.sm }}>
        {t('profile.memberSince', { date: formatDate(user.createdAt, lang) })}
      </Text>

      <SectionTitle title={t('profile.settings')} />
      <View style={styles.menu}>
        <MenuRow icon="camera" label={t('photos.change')} onPress={changePhoto} />
        {user.photoId ? <MenuRow icon="trash-2" label={t('photos.removeProfile')} onPress={removePhoto} /> : null}
        <MenuRow icon="globe" label={t('profile.language')} value={languageLabel} onPress={() => router.push('/language')} />
        <MenuRow icon="help-circle" label={t('profile.help')} onPress={() => router.push('/help')} last />
      </View>

      <View style={styles.menu}>
        <MenuRow icon="log-out" label={t('profile.signOut')} onPress={doSignOut} tone="danger" last />
      </View>

      <Text variant="small" tone="faint" align="center">
        {t('profile.version', { version: Constants.expoConfig?.version ?? '1.0.0' })}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.sm },
  cameraBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
});
