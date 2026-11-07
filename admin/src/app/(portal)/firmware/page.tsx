'use client';

import { ArrowUpCircle, Ban, Cpu, Play, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { ActionDialog, Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, Skeleton, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ago, dateTime, num } from '@/lib/format';

export default function FirmwarePage() {
  const fw = useQuery<any>('firmware', { refreshMs: 60_000 });
  const can = useCan();
  const toast = useToast();
  const [upload, setUpload] = useState(false);
  const [halt, setHalt] = useState<number | null>(null);

  if (fw.error) return <ErrorBox error={fw.error} onRetry={fw.reload} />;
  const d = fw.data;
  const totalRooms = d?.rooms.length ?? 0;

  return (
    <>
      <PageHeader
        title="Firmware"
        subtitle="Controllers check every 6 hours and install newer firmware by themselves; a version that crashes rolls back on its own. Release to beta rooms first, then promote."
        actions={can('operations') && <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setUpload(true)}>Upload release</Button>}
      />
      {!d ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Releases" subtitle="Bar: share of active rooms running that version" />
            {d.releases.length ? (
              <Table>
                <thead><tr><Th>Version</Th><Th>Channel</Th><Th>Rollout</Th><Th>Notes</Th><Th>Released</Th><Th /></tr></thead>
                <tbody>
                  {d.releases.map((r: any) => {
                    const share = totalRooms ? r.roomsRunning / totalRooms : 0;
                    return (
                      <tr key={r.version}>
                        <Td>
                          <span className="font-semibold">v{r.version}</span>
                          <div className="font-mono text-xs text-ink-3" title={r.sha256}>{r.sha256.slice(0, 12)}… · {num(Math.round(r.size / 1024))} KB</div>
                        </Td>
                        <Td>{r.haltedAt ? <Badge tone="critical">Halted</Badge> : r.channel === 'beta' ? <Badge tone="info">Beta</Badge> : <Badge tone="good">Stable</Badge>}</Td>
                        <Td className="min-w-40">
                          <div className="h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${share * 100}%` }} /></div>
                          <div className="mt-1 text-xs text-ink-3">{r.roomsRunning} of {totalRooms} rooms</div>
                        </Td>
                        <Td className="max-w-xs text-[13px] text-ink-2">{r.notes || '–'}</Td>
                        <Td>{dateTime(r.createdAt)}<div className="text-xs text-ink-3">{r.createdBy ?? 'command line'}</div></Td>
                        <Td align="right">
                          {can('operations') && (
                            <div className="flex justify-end gap-1.5">
                              {r.channel === 'beta' && !r.haltedAt && (
                                <Button size="sm" icon={<ArrowUpCircle className="size-3.5" />} onClick={async () => { await api(`firmware/${r.version}/promote`, { method: 'POST' }); toast(`v${r.version} goes to all rooms`); await fw.reload(); }}>Promote</Button>
                              )}
                              {r.haltedAt ? (
                                <Button size="sm" icon={<Play className="size-3.5" />} onClick={async () => { await api(`firmware/${r.version}/resume`, { method: 'POST' }); toast('Resumed'); await fw.reload(); }}>Resume</Button>
                              ) : (
                                <Button size="sm" icon={<Ban className="size-3.5" />} onClick={() => setHalt(r.version)}>Halt</Button>
                              )}
                            </div>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <EmptyState icon={<Cpu className="size-6" />} title="No releases yet" body="Upload a compiled harvest_hold_controller.ino.bin." />
            )}
          </Card>

          <Card>
            <CardHeader title="Controllers" subtitle="What each room runs, and what it is offered" />
            <Table>
              <thead><tr><Th>Room</Th><Th>Channel</Th><Th>Running</Th><Th>Offered</Th><Th>Last contact</Th></tr></thead>
              <tbody>
                {d.rooms.map((r: any) => (
                  <tr key={r.id}>
                    <Td><Link href={`/rooms/${r.id}`} className="font-medium hover:underline">{r.name}</Link></Td>
                    <Td className="capitalize">{r.channel}</Td>
                    <Td>{r.version ? `v${r.version}` : '–'}</Td>
                    <Td>{r.offered ? `v${r.offered}` : '–'} {r.upToDate ? <Badge tone="good">Up to date</Badge> : r.offered ? <Badge tone="warning">Update pending</Badge> : null}</Td>
                    <Td className="text-ink-2">{ago(r.lastUploadAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
      <UploadDialog open={upload} onClose={() => setUpload(false)} latest={d?.releases[0]?.version ?? 0} onDone={fw.reload} />
      <ActionDialog
        open={halt !== null}
        onClose={() => setHalt(null)}
        title={`Halt v${halt}?`}
        description="Rooms stop being offered this version. Rooms that already installed it keep it until a newer release."
        confirmLabel="Halt release"
        danger
        reasonLabel="Reason"
        onConfirm={async (reason) => {
          await api(`firmware/${halt}/halt`, { method: 'POST', body: { reason } });
          toast(`v${halt} halted`);
          await fw.reload();
        }}
      />
    </>
  );
}

function UploadDialog({ open, onClose, latest, onDone }: { open: boolean; onClose: () => void; latest: number; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [channel, setChannel] = useState('beta');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('version', version);
      form.set('channel', channel);
      form.set('notes', notes);
      form.set('file', file);
      const r = await api<{ version: number; sha256: string }>('firmware', { method: 'POST', form });
      toast(`v${r.version} released to ${channel} rooms`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload a firmware release"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} disabled={!file || !version}>Release</Button></>}
    >
      <div className="space-y-4">
        <Field label="Firmware file" hint="harvest_hold_controller.ino.bin from the Arduino build (checked: ESP32 image, fits the update slot).">
          <input type="file" accept=".bin,application/octet-stream" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Version" hint={`FW_VERSION in config.h; higher than v${latest}`} htmlFor="fv"><Input id="fv" inputMode="numeric" value={version} onChange={(e) => setVersion(e.target.value.replace(/\D/g, ''))} placeholder={String(latest + 1)} /></Field>
          <Field label="Release to" htmlFor="fc"><Select id="fc" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="beta">Beta rooms first</option><option value="stable">All rooms</option></Select></Field>
        </div>
        <Field label="What changed" htmlFor="fn"><Textarea id="fn" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {error && <p className="text-sm text-critical-ink">{error}</p>}
      </div>
    </Modal>
  );
}
