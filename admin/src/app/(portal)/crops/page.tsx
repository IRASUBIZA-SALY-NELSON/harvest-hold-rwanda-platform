'use client';

import { Sprout } from 'lucide-react';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Skeleton, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { crop, dateTime } from '@/lib/format';

/** The numbers that drive the controllers and the app, with what each one does. */
const FIELDS: { block: 'controller' | 'app'; key: string; label: string; unit: string; help: string }[] = [
  { block: 'controller', key: 'targetC', label: 'Target temperature', unit: '°C', help: 'What the controller holds the chamber at.' },
  { block: 'controller', key: 'hysteresisC', label: 'Control band', unit: '°C', help: 'How far above/below target before the controller reacts.' },
  { block: 'controller', key: 'freezeGuardC', label: 'Freeze guard', unit: '°C', help: 'Cooling stops if the coldest air drops below this.' },
  { block: 'controller', key: 'alarmLowC', label: 'Too-cold alarm', unit: '°C', help: 'SMS when the coldest air is below this for 10 min.' },
  { block: 'controller', key: 'alarmHighC', label: 'Too-warm alarm', unit: '°C', help: 'SMS when the chamber is above this for the grace time.' },
  { block: 'controller', key: 'alarmGraceMin', label: 'Alarm grace time', unit: 'min', help: 'How long it must be too warm before the controller warns.' },
  { block: 'controller', key: 'rhLow', label: 'Humidifier on below', unit: '%', help: 'Only with a humidifier fitted.' },
  { block: 'controller', key: 'rhHigh', label: 'Humidifier off above', unit: '%', help: '' },
  { block: 'app', key: 'safeMin', label: 'Safe range from', unit: '°C', help: 'Certificates and freshness: lower edge.' },
  { block: 'app', key: 'safeMax', label: 'Safe range to', unit: '°C', help: 'Certificates and freshness: upper edge.' },
  { block: 'app', key: 'humidityMin', label: 'Humidity from', unit: '%', help: '' },
  { block: 'app', key: 'humidityMax', label: 'Humidity to', unit: '%', help: '' },
  { block: 'app', key: 'excursionGraceMin', label: 'Freshness grace', unit: 'min', help: 'A spell outside the range counts only if it lasts this long.' },
  { block: 'app', key: 'humidityGraceMin', label: 'Humidity grace', unit: 'min', help: 'Same for humidity.' },
];

export default function CropsPage() {
  const list = useQuery<any[]>('crops');
  const can = useCan();
  const [editing, setEditing] = useState<any>(null);

  return (
    <>
      <PageHeader
        title="Crop profiles"
        subtitle="Each crop's storage rules. The controllers, freshness, certificates and alerts all follow them. Changes reach the rooms within 10 minutes and are checked against the same safety limits as the firmware."
      />
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {!list.data ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !list.data.length ? (
        <Card><EmptyState icon={<Sprout className="size-6" />} title="No profiles" /></Card>
      ) : (
        <div className="space-y-6">
          {list.data.map((p) => (
            <Card key={p.crop}>
              <CardHeader
                title={<span className="flex items-center gap-2">{crop(p.crop)} <Badge>v{p.version}</Badge> <Badge tone="brand">{p.rooms} room{p.rooms === 1 ? '' : 's'}</Badge></span>}
                subtitle={`Updated ${dateTime(p.updatedAt)} · ${p.data.status ?? ''}`}
                actions={can('operations') && <Button onClick={() => setEditing(p)}>Edit</Button>}
              />
              <Table>
                <thead><tr><Th>Setting</Th><Th align="right">Value</Th><Th>What it does</Th></tr></thead>
                <tbody>
                  {FIELDS.map((f) => (
                    <tr key={`${f.block}.${f.key}`}>
                      <Td>{f.label}</Td>
                      <Td align="right">{p.data[f.block]?.[f.key] ?? '–'} {f.unit}</Td>
                      <Td className="text-[13px] text-ink-3">{f.help}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="border-t border-line px-5 py-3 text-[13px] text-ink-2">
                Can share a room with: {p.data.compatible_in_same_room?.map(crop).join(', ') || '–'}
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <EditProfile profile={editing} onClose={() => setEditing(null)} onSaved={list.reload} />}
    </>
  );
}

function EditProfile({ profile, onClose, onSaved }: { profile: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [`${f.block}.${f.key}`, String(profile.data[f.block]?.[f.key] ?? '')]))
  );
  const [reason, setReason] = useState('');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changes = FIELDS.filter((f) => Number(values[`${f.block}.${f.key}`]) !== profile.data[f.block]?.[f.key]);
  const next = () => {
    const data = structuredClone(profile.data);
    for (const f of FIELDS) data[f.block][f.key] = Number(values[`${f.block}.${f.key}`]);
    return data;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ version: number }>(`crops/${profile.crop}`, { method: 'PUT', body: { data: next(), reason } });
      toast(`${crop(profile.crop)} profile is now v${r.version}`);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setReview(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Edit ${crop(profile.crop)} profile`}
      footer={
        review ? (
          <><Button variant="ghost" onClick={() => setReview(false)}>Back</Button><Button variant="primary" loading={busy} onClick={save}>Apply to {profile.rooms} room{profile.rooms === 1 ? '' : 's'}</Button></>
        ) : (
          <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!changes.length || reason.trim().length < 10} onClick={() => setReview(true)}>Review {changes.length} change{changes.length === 1 ? '' : 's'}</Button></>
        )
      }
    >
      {review ? (
        <div className="space-y-3 text-sm">
          <p className="text-ink-2">These changes become version {profile.version + 1}. Controllers pick them up within 10 minutes; certificates issued from now use them.</p>
          <Table>
            <thead><tr><Th>Setting</Th><Th align="right">Now</Th><Th align="right">New</Th></tr></thead>
            <tbody>
              {changes.map((f) => (
                <tr key={f.key}>
                  <Td>{f.label}</Td>
                  <Td align="right" className="text-critical-ink">{profile.data[f.block][f.key]} {f.unit}</Td>
                  <Td align="right" className="font-medium text-good-ink">{values[`${f.block}.${f.key}`]} {f.unit}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="text-[13px] text-ink-3">Reason: {reason}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <Field key={`${f.block}.${f.key}`} label={`${f.label} (${f.unit})`} hint={f.help || undefined} htmlFor={f.key}>
                <Input id={f.key} inputMode="decimal" value={values[`${f.block}.${f.key}`]} onChange={(e) => setValues((v) => ({ ...v, [`${f.block}.${f.key}`]: e.target.value }))} />
              </Field>
            ))}
          </div>
          <Field label="Why the change" hint="At least 10 characters. Kept in the audit trail with the exact values." htmlFor="why">
            <Textarea id="why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="E.g. RAB advice: hold carrots at 1.5°C" />
          </Field>
          {error && <p className="text-sm text-critical-ink">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
