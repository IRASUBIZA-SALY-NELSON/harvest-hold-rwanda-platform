import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { colors, spacing } from '@/theme';

import { Text } from './text';

interface Props {
  values: number[];
  /** Shaded safe band. */
  band?: { min: number; max: number };
  height?: number;
  xLabels: [string, string, string];
  formatY: (n: number) => string;
  accessibilityLabel: string;
}

/** Minimal line chart: one series, a shaded safe band, three x labels. */
export function LineChart({ values, band, height = 160, xLabels, formatY, accessibilityLabel }: Props) {
  const [width, setWidth] = useState(0);
  const padTop = 8;
  const padBottom = 8;

  const lo = Math.min(...values, band?.min ?? Infinity) - 1;
  const hi = Math.max(...values, band?.max ?? -Infinity) + 1;
  const y = (v: number) => padTop + (1 - (v - lo) / (hi - lo)) * (height - padTop - padBottom);
  const x = (i: number) => (values.length < 2 ? 0 : (i / (values.length - 1)) * width);

  const path = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const outOfBand = band ? values.map((v) => v < band.min || v > band.max) : [];

  return (
    <View accessible accessibilityLabel={accessibilityLabel}>
      <View style={styles.row}>
        <View style={{ flex: 1 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {width > 0 && (
            <Svg width={width} height={height}>
              {band && (
                <Rect
                  x={0}
                  y={y(band.max)}
                  width={width}
                  height={Math.max(0, y(band.min) - y(band.max))}
                  fill={colors.brandSoft}
                />
              )}
              {band && (
                <>
                  <Line x1={0} x2={width} y1={y(band.max)} y2={y(band.max)} stroke={colors.border} strokeDasharray="4 4" />
                  <Line x1={0} x2={width} y1={y(band.min)} y2={y(band.min)} stroke={colors.border} strokeDasharray="4 4" />
                </>
              )}
              <Path d={path} stroke={colors.brand} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {outOfBand.map((out, i) =>
                out ? <Rect key={i} x={x(i) - 1.5} y={y(values[i]) - 1.5} width={3} height={3} fill={colors.warning} /> : null
              )}
            </Svg>
          )}
        </View>
        {band && (
          <View style={[styles.yAxis, { height }]}>
            <Text variant="caption" tone="faint" style={{ position: 'absolute', top: y(band.max) - 7 }}>
              {formatY(band.max)}
            </Text>
            <Text variant="caption" tone="faint" style={{ position: 'absolute', top: y(band.min) - 7 }}>
              {formatY(band.min)}
            </Text>
          </View>
        )}
      </View>
      <View style={[styles.xAxis, band && { marginRight: 44 }]}>
        {xLabels.map((l, i) => (
          <Text key={i} variant="caption" tone="faint" style={{ letterSpacing: 0 }}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  yAxis: { width: 44, paddingLeft: spacing.sm },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
});
