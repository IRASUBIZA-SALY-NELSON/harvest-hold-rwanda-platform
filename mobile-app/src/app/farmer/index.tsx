import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { getColdRoomStatus, getHistory, isBatteryLow, type ColdRoom, type Reading } from '@/api';
import { formatNumber, formatRelative, formatTemp, formatTime } from '@/i18n/format';
import { useLabels } from '@/lib/hooks';
import { useUser } from '@/state/auth';
import { ColdRoomFlow, HOT_SIDE_WARN_C } from '@/features/cold-room-flow';
import { useApi } from '@/state/use-api';
import { colors, radius, spacing } from '@/theme';
import { Badge, Card, ErrorState, InfoRow, LineChart, Loading, Screen, SectionTitle, Text, type IconName } from '@/ui';

const LIVE_REFRESH_MS = 10_000;

export default function ColdRoomHome() {
  const user = useUser();
  const { t, lang } = useLabels();
  const roomId = user.coldRoomId ?? '';
  const status = useApi(() => getColdRoomStatus(roomId), [roomId], { pollMs: LIVE_REFRESH_MS });
  const day = useApi(() => getHistory(roomId, '24h'), [roomId]);

  const firstName = user.name.split(' ')[0];

  if (status.loading) return <Screen inTabs><Loading /></Screen>;
  if (!status.data) {
    return (
      <Screen inTabs>
        <ErrorState message={t('common.somethingWrong')} retryLabel={t('common.retry')} onRetry={status.refresh} />
      </Screen>
    );
  }

  const { room, last24h, storedCrates, energyTodayWh } = status.data;
  const peltier = room.coolingType === 'peltier';
  const hotSideHigh = (status.data.reading?.hotSide ?? 0) > HOT_SIDE_WARN_C;
  const hasData = status.data.reading !== null;
  const reading = status.data.reading ?? noReading();
  const state = roomState(room, reading);
  const dayChamber = (day.data ?? []).filter((r) => r.chamber !== null);

  return (
    <Screen inTabs refreshing={status.refreshing} onRefresh={status.refresh}>
      <View style={styles.header}>
        <Text tone="muted">{t('coldRoom.greeting', { name: firstName })}</Text>
        <Text variant="display" accessibilityRole="header">
          {room.name}
        </Text>
        <View style={styles.location}>
          <Feather name="map-pin" size={13} color={colors.textFaint} />
          <Text variant="small" tone="faint">
            {t('coldRoom.location', { sector: room.sector, district: room.district })}
          </Text>
        </View>
      </View>

      <View style={styles.scene}>
        <View style={styles.onlinePill}>
          <View style={[styles.onlineDot, !reading.online && { backgroundColor: colors.textFaint }]} />
          <Text variant="smallMedium">{t(reading.online ? 'coldRoom.online' : 'coldRoom.offline')}</Text>
        </View>
        <ColdRoomFlow reading={reading} coolingType={room.coolingType} lang={lang} warn={state !== 'good'} />
      </View>

      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <Text variant="smallMedium" tone="muted">
            {t('coldRoom.chamber')}
          </Text>
          <Badge
            tone={state === 'good' ? 'brand' : 'warning'}
            label={t(
              state === 'good' ? 'coldRoom.statusGood' : state === 'warm' ? 'coldRoom.statusWarm' : state === 'cold' ? 'coldRoom.statusCold' : 'coldRoom.statusOffline'
            )}
          />
        </View>
        <Text variant="metric" testID="chamber-temp" tone={state === 'good' ? 'default' : 'warning'}>
          {formatTemp(reading.chamber, lang)}
        </Text>
        <View style={styles.heroBottom}>
          <Text variant="small" tone="muted">
            {t('coldRoom.safeRange', { min: room.safeMin, max: room.safeMax })}
          </Text>
          <Text variant="small" tone="faint">
            {hasData ? t('coldRoom.updated', { time: formatRelative(reading.at, t) }) : t('coldRoom.noData')}
          </Text>
        </View>
      </Card>

      <View style={styles.grid}>
        <Tile icon="droplet" label={t('coldRoom.humidity')} value={reading.humidity === null ? '–' : `${reading.humidity}%`} />
        {peltier ? (
          <Tile
            icon="wind"
            label={t('coldRoom.cooler')}
            value={reading.coolerDuty === null || reading.coolerDuty === undefined ? '–' : `${reading.coolerDuty}%`}
            note={t('coldRoom.hotSide', { temp: formatTemp(reading.hotSide, lang) })}
            warn={hotSideHigh}
          />
        ) : (
          <Tile icon="box" label={t('coldRoom.iceBank')} value={formatTemp(reading.iceBank, lang)} />
        )}
        <Tile
          icon={reading.solarCharging ? 'sun' : 'battery'}
          label={t('coldRoom.battery')}
          value={reading.battery === null ? '–' : `${reading.battery}%`}
          note={t(reading.solarCharging ? 'coldRoom.charging' : 'coldRoom.notCharging')}
          warn={isBatteryLow(reading)}
        />
        <Tile icon="cloud" label={t('coldRoom.outside')} value={formatTemp(reading.outside, lang)} />
        {peltier && (
          <>
            <Tile
              icon="zap"
              label={t('coldRoom.energy')}
              value={formatEnergy(energyTodayWh, lang)}
              note={reading.coolerPower === null || reading.coolerPower === undefined ? undefined : t('coldRoom.powerNow', { watts: reading.coolerPower })}
            />
            <Tile icon="thermometer" label={t('coldRoom.product')} value={formatTemp(reading.product, lang)} note={t('coldRoom.productNote')} />
          </>
        )}
      </View>

      <SectionTitle title={t('coldRoom.equipment')} />
      <Card style={{ paddingVertical: spacing.xs }}>
        {peltier ? (
          <>
            <Equipment label={t('coldRoom.cooler')} on={(reading.coolerDuty ?? 0) > 0} />
            <Equipment label={t('coldRoom.hotFan')} on={!!reading.hotFan} />
            <Equipment label={t('coldRoom.innerFan')} on={reading.fan} last />
          </>
        ) : (
          <>
            <Equipment label={t('coldRoom.pump')} on={reading.pump} />
            <Equipment label={t('coldRoom.fan')} on={reading.fan} />
            <Equipment label={t('coldRoom.compressor')} on={reading.compressor} last />
          </>
        )}
      </Card>

      <SectionTitle
        title={t('coldRoom.last24h')}
        action={{ label: t('coldRoom.viewHistory'), onPress: () => router.push(`/cold-room/${room.id}`) }}
      />
      <Card style={{ gap: spacing.lg }}>
        {dayChamber.length >= 2 && (
          <LineChart
            values={dayChamber.map((r) => r.chamber as number)}
            band={{ min: room.safeMin, max: room.safeMax }}
            height={120}
            xLabels={[
              formatTime(dayChamber[0].at),
              formatTime(dayChamber[Math.floor(dayChamber.length / 2)].at),
              formatTime(dayChamber[dayChamber.length - 1].at),
            ]}
            formatY={(n) => `${n}°`}
            accessibilityLabel={t('coldRoom.last24h')}
          />
        )}
        <View style={styles.stats}>
          <Stat label={t('coldRoom.avg')} value={formatTemp(last24h.avgTemp, lang)} />
          <Stat label={t('coldRoom.min')} value={formatTemp(last24h.minTemp, lang)} />
          <Stat label={t('coldRoom.max')} value={formatTemp(last24h.maxTemp, lang)} />
        </View>
        <Badge
          tone={last24h.minutesOutOfRange ? 'warning' : 'brand'}
          label={
            last24h.minutesOutOfRange
              ? t('coldRoom.outOfRange', { minutes: last24h.minutesOutOfRange })
              : t('coldRoom.inRangeAll')
          }
        />
      </Card>

      <SectionTitle title={t('coldRoom.storedHere')} />
      <Card>
        <InfoRow
          label={t('coldRoom.spaceUsed')}
          value={t('coldRoom.usedSpace', { used: storedCrates, total: room.capacityCrates })}
          last
        />
        <View style={styles.capacityTrack}>
          <View style={[styles.capacityFill, { width: `${Math.min(100, (storedCrates / room.capacityCrates) * 100)}%` }]} />
        </View>
      </Card>

      <Card style={{ backgroundColor: colors.surface, borderColor: colors.surface, gap: spacing.xs }}>
        <Text variant="smallMedium">{t('coldRoom.howItWorks')}</Text>
        <Text variant="small" tone="muted">
          {t(peltier ? 'coldRoom.howItWorksPeltier' : 'coldRoom.howItWorksBody')}
        </Text>
      </Card>
    </Screen>
  );
}

type RoomState = 'good' | 'warm' | 'cold' | 'offline';

/** Shown before the controller has ever reported. */
function noReading(): Reading {
  return {
    at: new Date(0).toISOString(),
    chamber: null,
    humidity: null,
    iceBank: null,
    outside: null,
    battery: null,
    solarCharging: false,
    pump: false,
    fan: false,
    compressor: false,
    online: false,
  };
}

function roomState(room: ColdRoom, r: Reading): RoomState {
  if (!r.online || r.chamber === null) return 'offline';
  if (r.chamber > room.safeMax) return 'warm';
  if (r.chamber < room.safeMin) return 'cold';
  return 'good';
}

function Tile({ icon, label, value, note, warn }: { icon: IconName; label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <Card style={styles.tile}>
      <View style={styles.tileLabel}>
        <View style={[styles.tileIcon, warn && { backgroundColor: colors.warningSoft }]}>
          <Feather name={icon} size={16} color={warn ? colors.warning : colors.brand} />
        </View>
        <Text variant="small" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
      <Text variant="title" tone={warn ? 'warning' : 'default'}>
        {value}
      </Text>
      {note && (
        <Text variant="small" tone="faint" numberOfLines={2}>
          {note}
        </Text>
      )}
    </Card>
  );
}

function Equipment({ label, on, last }: { label: string; on: boolean; last?: boolean }) {
  const { t } = useLabels();
  return (
    <InfoRow
      label={label}
      last={last}
      value={<Badge tone={on ? 'brand' : 'neutral'} label={t(on ? 'common.on' : 'common.off')} />}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="small" tone="muted">
        {label}
      </Text>
      <Text variant="heading">{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2, paddingTop: spacing.md },
  location: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  hero: { gap: spacing.xs, paddingVertical: spacing.lg + 2 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  heroBottom: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { flexBasis: '47%', flexGrow: 1, gap: spacing.xs, padding: spacing.md + 2 },
  tileLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 2 },
  tileIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scene: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  onlinePill: {
    alignSelf: 'flex-start',
    marginLeft: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.leaf },
  stats: { flexDirection: 'row', gap: spacing.md },
  capacityTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surface, overflow: 'hidden', marginTop: spacing.xs },
  capacityFill: { height: '100%', backgroundColor: colors.leaf, borderRadius: radius.pill },
});

/** 850 -> "850 Wh", 1240 -> "1.2 kWh". */
function formatEnergy(wh: number | null, lang: string): string {
  if (wh === null) return '–';
  if (wh < 1000) return `${formatNumber(wh, lang)} Wh`;
  return `${formatNumber(Math.round(wh / 100) / 10, lang)} kWh`;
}
