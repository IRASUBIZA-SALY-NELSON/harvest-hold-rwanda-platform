import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { CoolingType, Reading } from '@/api';
import { formatTemp } from '@/i18n/format';
import { colors, spacing } from '@/theme';
import { Text } from '@/ui';

const NODE = 48;
const DOTS = 3;
const sun = '#E9A23B';
const cold = '#4A9FD1';

type Icon = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Hot side above this: the controller is already cutting power (see firmware HOT_SIDE_LIMIT_C). */
export const HOT_SIDE_WARN_C = 55;

/**
 * Live diagram of how the cold room works. Dots only move along a link while that part is
 * actually running.
 * - Peltier prototype: the sun charges the battery, the battery powers the Peltier cooler,
 *   and the cooler's fan blows cold air into the chamber. Dots move faster at higher power.
 * - Ice bank: the battery runs the compressor that freezes the ice bank, and the pump sends
 *   cold water to the chamber.
 */
export function ColdRoomFlow({ reading, coolingType, lang, warn }: { reading: Reading; coolingType: CoolingType; lang: string; warn: boolean }) {
  const { t } = useTranslation();
  const live = reading.online;
  const charging = live && reading.solarCharging;
  const peltier = coolingType === 'peltier';
  const duty = reading.coolerDuty ?? 0;
  const hotSideHigh = (reading.hotSide ?? 0) > HOT_SIDE_WARN_C;

  const powering = live && (peltier ? duty > 0 : reading.compressor);
  const cooling = live && (peltier ? duty > 0 && reading.fan : reading.pump);
  // Faster dots at higher power: 2.4 s per trip when idling up to 0.9 s at full power.
  const speed = peltier ? 2400 - duty * 15 : 1500;

  const activity = [
    charging && t('coldRoom.flowCharging'),
    peltier ? powering && t('coldRoom.flowCoolerPower', { power: duty }) : powering && t('coldRoom.flowFreezing'),
    !peltier && cooling && t('coldRoom.flowCooling'),
    peltier && live && hotSideHigh && t('coldRoom.flowHotSide'),
  ].filter(Boolean);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Node
          icon={charging ? 'white-balance-sunny' : 'weather-night'}
          color={sun}
          active={charging}
          value={t(charging ? 'coldRoom.flowSun' : 'coldRoom.flowNoSun')}
          label={t('coldRoom.flowSolar')}
        />
        <Link active={charging} color={sun} />
        <Node
          icon={charging ? 'battery-charging-high' : 'battery-high'}
          color={colors.leaf}
          active={live}
          value={reading.battery === null ? '–' : `${reading.battery}%`}
          label={t('coldRoom.battery')}
        />
        <Link active={powering} color={colors.leaf} duration={speed} />
        {peltier ? (
          <Node
            icon="snowflake-thermometer"
            color={hotSideHigh ? colors.warning : cold}
            active={powering}
            value={live && reading.coolerDuty !== null && reading.coolerDuty !== undefined ? `${reading.coolerDuty}%` : '–'}
            valueTone={hotSideHigh ? 'warning' : 'default'}
            label={t('coldRoom.cooler')}
          />
        ) : (
          <Node icon="snowflake" color={cold} active={powering} value={formatTemp(reading.iceBank, lang)} label={t('coldRoom.iceBank')} />
        )}
        <Link active={cooling} color={cold} duration={speed} />
        <Node
          icon="fan"
          color={warn ? colors.warning : colors.brand}
          active={live && reading.fan}
          spin={live && reading.fan}
          value={formatTemp(reading.chamber, lang)}
          valueTone={warn ? 'warning' : 'default'}
          label={t('coldRoom.chamber')}
        />
      </View>
      <Text variant="small" tone={peltier && live && hotSideHigh ? 'warning' : 'muted'} align="center" numberOfLines={1}>
        {!live ? t('coldRoom.statusOffline') : activity.length ? activity.join(' · ') : t('coldRoom.flowIdle')}
      </Text>
    </View>
  );
}

function Node({
  icon,
  color,
  active,
  spin = false,
  value,
  valueTone = 'default',
  label,
}: {
  icon: Icon;
  color: string;
  active: boolean;
  spin?: boolean;
  value: string;
  valueTone?: 'default' | 'warning';
  label: string;
}) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (spin && !reduced) {
      turn.value = 0;
      turn.value = withRepeat(withTiming(360, { duration: 1100, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(turn);
      turn.value = 0;
    }
    return () => cancelAnimation(turn);
  }, [spin, reduced, turn]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));

  return (
    <View style={styles.node}>
      <View style={[styles.circle, { borderColor: active ? color : colors.borderStrong }]}>
        <Animated.View style={iconStyle}>
          <MaterialCommunityIcons name={icon} size={24} color={active ? color : colors.textFaint} />
        </Animated.View>
      </View>
      <Text variant="smallMedium" tone={valueTone} numberOfLines={1}>
        {value}
      </Text>
      <Text variant="caption" tone="faint" numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

function Link({ active, color, duration = 1500 }: { active: boolean; color: string; duration?: number }) {
  const reduced = useReducedMotion();
  const width = useSharedValue(0);
  const progress = useSharedValue(0);
  const moving = active && !reduced;

  useEffect(() => {
    if (moving) {
      progress.value = 0;
      progress.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(progress);
      progress.value = 0;
    }
    return () => cancelAnimation(progress);
  }, [moving, progress, duration]);

  return (
    <View style={styles.link} onLayout={(e) => (width.value = e.nativeEvent.layout.width)}>
      <View style={[styles.track, active ? { backgroundColor: color, opacity: 0.25 } : styles.trackOff]} />
      {moving && Array.from({ length: DOTS }, (_, i) => <Dot key={i} offset={i / DOTS} progress={progress} width={width} color={color} />)}
    </View>
  );
}

function Dot({ offset, progress, width, color }: { offset: number; progress: SharedValue<number>; width: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const p = (progress.value + offset) % 1;
    // Fade in and out at the ends so dots don't pop at the node edges.
    const fade = Math.min(1, p * 5, (1 - p) * 5);
    return { opacity: fade, transform: [{ translateX: p * Math.max(0, width.value - 6) }] };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  node: { width: 64, alignItems: 'center', gap: 2 },
  circle: {
    width: NODE,
    height: NODE,
    borderRadius: NODE / 2,
    borderWidth: 1.5,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  label: { letterSpacing: 0 },
  link: { flex: 1, height: 6, marginTop: NODE / 2 - 3, marginHorizontal: -6, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 1 },
  trackOff: { backgroundColor: colors.borderStrong },
  dot: { position: 'absolute', left: 0, width: 6, height: 6, borderRadius: 3 },
});
