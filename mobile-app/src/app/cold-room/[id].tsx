import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { getColdRoom, getHistory, type HistoryRange, type Reading } from '@/api';
import { HOT_SIDE_WARN_C } from '@/features/cold-room-flow';
import { formatDate, formatTemp, formatTime } from '@/i18n/format';
import { useLabels } from '@/lib/hooks';
import { useApi } from '@/state/use-api';
import { spacing } from '@/theme';
import { Badge, Card, LineChart, Loading, Screen, Segmented, Text } from '@/ui';

export default function ColdRoomHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useLabels();
  const [range, setRange] = useState<HistoryRange>('24h');
  const room = useApi(() => getColdRoom(id), [id]);
  const readings = useApi(() => getHistory(id, range), [id, range]);

  const label = (r: Reading) => (range === '24h' ? formatTime(r.at) : formatDate(r.at, lang).split(' ').slice(0, 2).join(' '));
  /** Values of one sensor, skipping time slots where it did not report. */
  const series = (key: 'chamber' | 'humidity' | 'iceBank' | 'coolerDuty' | 'hotSide') => {
    const rs = (readings.data ?? []).filter((r) => r[key] !== null && r[key] !== undefined);
    return {
      values: rs.map((r) => r[key] as number),
      xLabels: (rs.length ? [label(rs[0]), label(rs[Math.floor(rs.length / 2)]), label(rs[rs.length - 1])] : ['', '', '']) as [string, string, string],
      count: rs.length,
    };
  };

  const chamber = series('chamber');
  const humidity = series('humidity');
  const ice = series('iceBank');
  const duty = series('coolerDuty');
  const hot = series('hotSide');
  const peltier = room.data?.coolingType === 'peltier';
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

  return (
    <Screen header={{ title: room.data?.name }} title={t('coldRoom.history')}>
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: '24h', label: t('coldRoom.range24h') },
          { value: '7d', label: t('coldRoom.range7d') },
        ]}
      />
      {!room.data || !readings.data ? (
        <Loading />
      ) : chamber.count < 2 ? (
        <Card>
          <Text tone="muted">{t('coldRoom.noData')}</Text>
        </Card>
      ) : (
        <>
          <ChartCard
            title={t('coldRoom.chamber')}
            subtitle={t('coldRoom.safeRange', { min: room.data.safeMin, max: room.data.safeMax })}
            outCount={chamber.values.filter((v) => v < room.data!.safeMin || v > room.data!.safeMax).length}
          >
            <LineChart
              values={chamber.values}
              band={{ min: room.data.safeMin, max: room.data.safeMax }}
              xLabels={chamber.xLabels}
              formatY={(n) => `${n}°`}
              accessibilityLabel={t('coldRoom.chamber')}
            />
          </ChartCard>
          {humidity.count >= 2 && (
            <ChartCard title={t('coldRoom.humidity')} subtitle={`${room.data.humidityMin}–${room.data.humidityMax}%`}>
              <LineChart
                values={humidity.values}
                band={{ min: room.data.humidityMin, max: room.data.humidityMax }}
                xLabels={humidity.xLabels}
                formatY={(n) => `${n}%`}
                height={120}
                accessibilityLabel={t('coldRoom.humidity')}
              />
            </ChartCard>
          )}
          {peltier && duty.count >= 2 && (
            <ChartCard title={t('coldRoom.coolerPower')} subtitle={`${t('coldRoom.avg')} ${Math.round(avg(duty.values) ?? 0)}%`}>
              <LineChart
                values={duty.values}
                xLabels={duty.xLabels}
                formatY={(n) => `${n}%`}
                height={100}
                accessibilityLabel={t('coldRoom.coolerPower')}
              />
            </ChartCard>
          )}
          {peltier && hot.count >= 2 && (
            <ChartCard
              title={t('coldRoom.hotSideTitle')}
              subtitle={`${t('coldRoom.max')} ${formatTemp(Math.max(...hot.values), lang)} · ${t('coldRoom.hotSideLimit', { limit: HOT_SIDE_WARN_C })}`}
            >
              <LineChart
                values={hot.values}
                xLabels={hot.xLabels}
                formatY={(n) => `${n}°`}
                height={100}
                accessibilityLabel={t('coldRoom.hotSideTitle')}
              />
            </ChartCard>
          )}
          {!peltier && ice.count >= 2 && (
            <ChartCard title={t('coldRoom.iceBank')} subtitle={`${t('coldRoom.avg')} ${formatTemp(avg(ice.values), lang)}`}>
              <LineChart
                values={ice.values}
                xLabels={ice.xLabels}
                formatY={(n) => `${n}°`}
                height={100}
                accessibilityLabel={t('coldRoom.iceBank')}
              />
            </ChartCard>
          )}
        </>
      )}
    </Screen>
  );
}

function ChartCard({
  title,
  subtitle,
  outCount,
  children,
}: {
  title: string;
  subtitle: string;
  outCount?: number;
  children: React.ReactNode;
}) {
  const { t } = useLabels();
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Text variant="heading">{title}</Text>
          <Text variant="small" tone="muted">
            {subtitle}
          </Text>
        </View>
        {outCount !== undefined && (
          <Badge
            tone={outCount ? 'warning' : 'brand'}
            label={outCount ? t('freshness.attention') : t('freshness.fresh')}
          />
        )}
      </View>
      {children}
    </Card>
  );
}
