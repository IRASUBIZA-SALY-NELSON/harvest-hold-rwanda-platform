import Feather from '@expo/vector-icons/Feather';
import { router, type Href } from 'expo-router';
import type { TFunction } from 'i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { listAlerts, markAlertRead, markAllAlertsRead, type AlertItem, type AlertType, type CropId, type Unit } from '@/api';
import { formatQuantity, formatRelative } from '@/i18n/format';
import { useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { useApi } from '@/state/use-api';
import { colors, radius, spacing } from '@/theme';
import { EmptyState, ErrorState, Loading, Screen, SectionTitle, Text, type IconName } from '@/ui';

const ICONS: Record<AlertType, { icon: IconName; warn: boolean }> = {
  chamberWarm: { icon: 'thermometer', warn: true },
  chamberCold: { icon: 'thermometer', warn: true },
  coolerOverheat: { icon: 'alert-octagon', warn: true },
  coolerFault: { icon: 'alert-triangle', warn: true },
  coolingCapacity: { icon: 'trending-up', warn: true },
  humidityLow: { icon: 'droplet', warn: true },
  backToNormal: { icon: 'check-circle', warn: false },
  batteryLow: { icon: 'battery', warn: true },
  iceLow: { icon: 'box', warn: true },
  offline: { icon: 'wifi-off', warn: true },
  storageAccepted: { icon: 'check-circle', warn: false },
  storageDeclined: { icon: 'x-circle', warn: false },
  orderNew: { icon: 'shopping-bag', warn: false },
  orderAccepted: { icon: 'check-circle', warn: false },
  orderDeclined: { icon: 'x-circle', warn: false },
  orderCancelled: { icon: 'x-circle', warn: false },
};

export function alertMessage(a: AlertItem, t: TFunction): string {
  const p = { ...a.params };
  if (typeof p.crop === 'string') p.crop = t(`crops.${p.crop as CropId}`).toLowerCase();
  if (typeof p.quantity === 'number' && typeof p.unit === 'string') p.quantity = formatQuantity(p.quantity, p.unit as Unit, t);
  return t(`alerts.${a.type}`, p);
}

export function AlertsScreen() {
  const user = useUser();
  const { t } = useLabels();
  const alerts = useApi(() => listAlerts(user.id), [user.id]);

  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const today = alerts.data?.filter((a) => Date.parse(a.createdAt) >= startOfDay) ?? [];
  const earlier = alerts.data?.filter((a) => Date.parse(a.createdAt) < startOfDay) ?? [];
  const hasUnread = alerts.data?.some((a) => !a.read);

  const open = async (a: AlertItem) => {
    if (!a.read) await markAlertRead(user.id, a.id);
    if (a.link) router.push(a.link as Href);
  };

  return (
    <Screen
      inTabs
      title={t('alerts.title')}
      titleRight={
        hasUnread ? (
          <Pressable onPress={() => markAllAlertsRead(user.id)} hitSlop={10} style={{ paddingTop: spacing.md }} accessibilityRole="button">
            <Text variant="smallMedium" tone="brand">
              {t('alerts.markAll')}
            </Text>
          </Pressable>
        ) : undefined
      }
      refreshing={alerts.refreshing}
      onRefresh={alerts.refresh}
    >
      {alerts.loading ? (
        <Loading />
      ) : alerts.error ? (
        <ErrorState message={t('common.somethingWrong')} retryLabel={t('common.retry')} onRetry={alerts.refresh} />
      ) : !alerts.data?.length ? (
        <EmptyState icon="bell" title={t('alerts.empty')} body={t('alerts.emptyBody')} />
      ) : (
        <>
          {[
            { key: 'today', items: today },
            { key: 'earlier', items: earlier },
          ].map(
            (group) =>
              group.items.length > 0 && (
                <View key={group.key} style={{ gap: spacing.sm }}>
                  <SectionTitle title={t(`alerts.group_${group.key}`)} />
                  <View style={styles.list}>
                    {group.items.map((a, i) => (
                      <AlertRow key={a.id} alert={a} last={i === group.items.length - 1} onPress={() => open(a)} />
                    ))}
                  </View>
                </View>
              )
          )}
        </>
      )}
    </Screen>
  );
}

function AlertRow({ alert, last, onPress }: { alert: AlertItem; last: boolean; onPress: () => void }) {
  const { t } = useLabels();
  const meta = ICONS[alert.type];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !alert.read }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
      testID={`alert-${alert.id}`}
    >
      <View style={[styles.icon, { backgroundColor: meta.warn ? colors.warningSoft : colors.brandSoft }]}>
        <Feather name={meta.icon} size={18} color={meta.warn ? colors.warning : colors.brand} />
      </View>
      <View style={[styles.body, !last && styles.border]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant={alert.read ? 'body' : 'bodyMedium'} tone={alert.read ? 'muted' : 'default'}>
            {alertMessage(alert, t)}
          </Text>
          <Text variant="small" tone="faint">
            {formatRelative(alert.createdAt, t)}
          </Text>
        </View>
        {!alert.read && <View style={styles.unread} accessibilityLabel="unread" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: spacing.md, paddingLeft: spacing.lg, alignItems: 'flex-start' },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, paddingRight: spacing.lg },
  border: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  unread: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
});
