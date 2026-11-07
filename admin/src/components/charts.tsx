'use client';

import { BarChart3, Table2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardHeader, Table, Td, Th } from './ui';

/** Categorical slots in fixed order (validated palette; never cycled). */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

export interface Series {
  key: string;
  label: string;
  /** Slot color; defaults to the series' position. */
  color?: string;
}

const AXIS = { stroke: 'var(--axis)', tick: { fill: 'var(--ink-3)', fontSize: 12 }, tickLine: false };

function Legend({ series }: { series: (Series & { color: string })[] }) {
  if (series.length < 2) return null; // one series: the title names it
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-3 text-[13px] text-ink-2">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: s.color, height: 3 }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function TooltipBox({ active, payload, label, labelFormat, valueFormat }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-pop">
      <div className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full" style={{ background: p.color }} aria-hidden />
            {p.name}
          </span>
          <span className="tabular font-medium text-ink">{valueFormat ? valueFormat(p.value, p.dataKey) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * A chart in a card, with a switch to the same numbers as a table (for screen readers, print,
 * and anyone who cannot tell the colors apart).
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  series,
  rows,
  xKey,
  xFormat,
  valueFormat,
  children,
  height = 260,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  series: Series[];
  rows: Record<string, any>[];
  xKey: string;
  xFormat?: (v: any) => string;
  valueFormat?: (v: any, key: string) => string;
  children: (s: (Series & { color: string })[]) => ReactNode;
  height?: number;
}) {
  const [table, setTable] = useState(false);
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES[i % SERIES.length] }));
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {actions}
            <button
              onClick={() => setTable((t) => !t)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-ink-3 hover:bg-surface-3 hover:text-ink"
              aria-pressed={table}
            >
              {table ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
              {table ? 'Chart' : 'Table'}
            </button>
          </>
        }
      />
      {table ? (
        <Table className="max-h-[320px] overflow-y-auto">
          <thead>
            <tr>
              <Th />
              {colored.map((s) => (
                <Th key={s.key} align="right">
                  {s.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <Td className="text-ink-2">{xFormat ? xFormat(r[xKey]) : r[xKey]}</Td>
                {colored.map((s) => (
                  <Td key={s.key} align="right">
                    {r[s.key] === null || r[s.key] === undefined ? '–' : valueFormat ? valueFormat(r[s.key], s.key) : r[s.key]}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <>
          <Legend series={colored} />
          <div className="px-2 pb-3 pt-2" style={{ height }}>
            {rows.length ? (
              <ResponsiveContainer width="100%" height="100%">
                {children(colored) as any}
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-ink-3">No data for this period</div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

/** Lines over time (2 px, round joins), optional safe band, one y-axis. */
export function TimeLines({
  rows,
  xKey,
  series,
  xFormat,
  yFormat,
  valueFormat,
  band,
  refLine,
  yDomain,
}: {
  rows: Record<string, any>[];
  xKey: string;
  series: (Series & { color: string })[];
  xFormat?: (v: any) => string;
  yFormat?: (v: number) => string;
  valueFormat?: (v: any, key: string) => string;
  band?: [number, number];
  refLine?: { y: number; label: string };
  yDomain?: [number | 'auto', number | 'auto'];
}) {
  return (
    <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
      <CartesianGrid vertical={false} stroke="var(--grid)" />
      {band && <ReferenceArea y1={band[0]} y2={band[1]} fill="var(--band)" stroke="none" ifOverflow="extendDomain" />}
      {refLine && <ReferenceLine y={refLine.y} stroke="var(--critical)" strokeWidth={1} label={{ value: refLine.label, position: 'insideTopRight', fill: 'var(--ink-3)', fontSize: 11 }} />}
      <XAxis dataKey={xKey} {...AXIS} tickFormatter={xFormat} minTickGap={32} />
      <YAxis {...AXIS} axisLine={false} width={44} tickFormatter={yFormat} domain={yDomain ?? ['auto', 'auto']} allowDataOverflow={!!yDomain} />
      <Tooltip content={<TooltipBox labelFormat={xFormat} valueFormat={valueFormat} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
      {series.map((s) => (
        <Line
          key={s.key}
          dataKey={s.key}
          name={s.label}
          stroke={s.color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          dot={false}
          activeDot={{ r: 4, fill: s.color, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  );
}

/** Columns (≤ 24 px, 4 px rounded tops, 2 px surface gap between stacked segments). */
export function Columns({
  rows,
  xKey,
  series,
  xFormat,
  yFormat,
  valueFormat,
  stacked,
}: {
  rows: Record<string, any>[];
  xKey: string;
  series: (Series & { color: string })[];
  xFormat?: (v: any) => string;
  yFormat?: (v: number) => string;
  valueFormat?: (v: any, key: string) => string;
  stacked?: boolean;
}) {
  return (
    <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barGap={2}>
      <CartesianGrid vertical={false} stroke="var(--grid)" />
      <XAxis dataKey={xKey} {...AXIS} tickFormatter={xFormat} minTickGap={24} />
      <YAxis {...AXIS} axisLine={false} width={48} tickFormatter={yFormat} allowDecimals={false} />
      <Tooltip content={<TooltipBox labelFormat={xFormat} valueFormat={valueFormat} />} cursor={{ fill: 'var(--surface-3)' }} />
      {series.map((s, i) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.label}
          fill={s.color}
          maxBarSize={24}
          stackId={stacked ? 'stack' : undefined}
          stroke={stacked ? 'var(--chart-surface)' : undefined}
          strokeWidth={stacked ? 2 : 0}
          radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
          isAnimationActive={false}
        />
      ))}
    </BarChart>
  );
}
