'use client';

import { AlertTriangle, ExternalLink, FileJson, Printer, ShieldCheck, ShieldX, Sprout, XCircle } from 'lucide-react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { use, useEffect, useState } from 'react';

import { useCan } from '@/components/admin-context';
import { ActionDialog, Badge, Button, Card, CardHeader, ErrorBox, FreshnessBadge, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { crop, dateTime, qty, temp } from '@/lib/format';

const PUBLIC_API = (process.env.NEXT_PUBLIC_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const RESULT: Record<string, string> = {
  fresh: 'Kept in the safe range the whole time',
  attention: 'Conditions left the safe range: check quality',
  unknown: 'Not enough data to confirm',
};

export default function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cert = useQuery<any>(`certificates/${id}`);
  const can = useCan();
  const toast = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const verifyUrl = `${PUBLIC_API}/verify/${id}`;

  useEffect(() => {
    QRCode.toDataURL(verifyUrl, { margin: 0, width: 220, color: { dark: '#111A14', light: '#FFFFFF' } }).then(setQr);
  }, [verifyUrl]);

  if (cert.error) return <ErrorBox error={cert.error} onRetry={cert.reload} />;
  const c = cert.data;
  if (!c) return <Skeleton className="h-[600px] rounded-xl" />;
  const d = c.data;
  const cond = d.conditions;
  const photos: string[] = d.photos ?? [];
  const revoked = !!c.revokedAt;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/certificates" className="hover:underline">Certificates</Link>}
        title={<span className="font-mono">{d.id}</span>}
        subtitle={`${crop(d.batch.crop)} · ${qty(d.batch.quantity, d.batch.unit)} · ${d.farmer.name} · issued ${dateTime(d.issuedAt)}`}
        actions={
          <>
            <a href={verifyUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink hover:bg-surface-3">
              <ExternalLink className="size-4" /> Public page
            </a>
            <a href={`${PUBLIC_API}/verify/${d.id}.json`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink hover:bg-surface-3">
              <FileJson className="size-4" /> Signed data
            </a>
            <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
            {can('market') && !revoked && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => setRevoking(true)}>Revoke</Button>}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,720px)_1fr]">
        {/* The certificate as farmers and buyers see it */}
        <div className="print-sheet relative overflow-hidden rounded-2xl border border-line bg-white p-8 text-[#111A14] shadow-card">
          {revoked && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="-rotate-12 rounded-xl border-4 border-[#d03b3b] px-6 py-2 text-5xl font-bold tracking-widest text-[#d03b3b] opacity-80">REVOKED</span>
            </div>
          )}
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-lg bg-[#0b5a2b] text-white"><Sprout className="size-5" /></div>
              <div className="leading-tight">
                <div className="font-serif text-xl text-[#0b5a2b]">Harvest Hold</div>
                <div className="text-[11px] tracking-[0.35em] text-[#5e8c2e]">RWANDA</div>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt={`QR code to ${verifyUrl}`} className="size-24" />}
          </div>
          <h2 className="mt-6 text-2xl font-semibold tracking-tight">Cold storage certificate</h2>
          <p className="text-sm text-[#5e6b62]">Certificate no. {d.id} · Issued {dateTime(d.issuedAt)}</p>

          <dl className="mt-6 divide-y divide-[#e8ebe8] text-sm">
            {[
              ['Farmer', d.farmer.name],
              ['Product', `${crop(d.batch.crop)} · ${qty(d.batch.quantity, d.batch.unit)}`],
              ['Cold room', `${d.coldRoom.name}, ${d.coldRoom.district}`],
              ['Stored since', dateTime(d.batch.storedAt)],
              ['Time in storage', `${cond.hoursStored} h`],
              ['Safe range', `${cond.safeMin}–${cond.safeMax}°C · ${cond.humidityMin}–${cond.humidityMax}% humidity`],
              ['Average temperature', temp(cond.avgTemp)],
              ['Temperature range', `${temp(cond.minTemp)} – ${temp(cond.maxTemp)}`],
              ['Average humidity', cond.avgHumidity === null ? '–' : `${cond.avgHumidity}%`],
              ['Time outside safe range', `${cond.minutesOutOfRange} min`],
              ['Time without data', `${cond.minutesNoData} min`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5">
                <dt className="text-[#5e6b62]">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>

          <div className={`mt-6 rounded-xl px-4 py-3 font-semibold ${cond.freshness === 'fresh' ? 'bg-[#eef5f0] text-[#0b5a2b]' : cond.freshness === 'unknown' ? 'bg-[#f7f8f7] text-[#5e6b62]' : 'bg-[#fff4ec] text-[#c2410c]'}`}>
            Result: {RESULT[cond.freshness]}
          </div>
          {(cond.dataSource === 'simulated' || cond.dataSource === 'mixed') && (
            <div className="mt-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
              Test data: {cond.simulatedSamples} of {cond.samples} readings behind this certificate came from the development simulator, not from a real controller.
            </div>
          )}

          {photos.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 text-sm text-[#5e6b62]">Photos taken when the crop was stored</div>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={p} src={`/api/admin/photos/${p}/file?size=thumb`} alt="Crop at check-in" className="aspect-square w-full rounded-lg border border-[#e8ebe8] object-cover" />
                ))}
              </div>
            </div>
          )}

          <p className="mt-6 text-xs text-[#8e9991]">
            Scan the QR code or visit {verifyUrl} to check this certificate. Internal certificate: official RSB / NAEB certification is coming. Digitally signed by Harvest Hold (key {c.keyId ?? '–'}).
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Authenticity" />
            <div className="space-y-3 p-5 text-sm">
              {revoked ? (
                <div className="flex gap-3 rounded-lg bg-critical-soft p-3 text-critical-ink">
                  <ShieldX className="size-5 shrink-0" />
                  <div>
                    <div className="font-medium">Revoked {dateTime(c.revokedAt)}{c.revokedBy ? ` by ${c.revokedBy}` : ''}</div>
                    <div>{c.revokedReason}</div>
                  </div>
                </div>
              ) : !c.signature ? (
                <div className="flex gap-3 rounded-lg bg-warning-soft p-3 text-warning-ink"><AlertTriangle className="size-5 shrink-0" />Issued before digital signing was introduced.</div>
              ) : c.signatureValid ? (
                <div className="flex gap-3 rounded-lg bg-good-soft p-3 text-good-ink">
                  <ShieldCheck className="size-5 shrink-0" />
                  <div><div className="font-medium">Signature valid</div><div>The stored record is exactly what was signed when it was issued.</div></div>
                </div>
              ) : (
                <div className="flex gap-3 rounded-lg bg-critical-soft p-3 text-critical-ink">
                  <ShieldX className="size-5 shrink-0" />
                  <div><div className="font-medium">Signature does not match</div><div>This record was changed after it was issued. Investigate in the audit trail.</div></div>
                </div>
              )}
              <dl className="space-y-1 text-[13px] text-ink-2">
                <div>Algorithm: Ed25519 over the canonical JSON</div>
                <div>Key: <span className="font-mono">{c.keyId ?? '–'}</span></div>
                <div className="break-all">Signature: <span className="font-mono text-ink-3">{c.signature ? `${c.signature.slice(0, 32)}…` : '–'}</span></div>
              </dl>
            </div>
          </Card>
          <Card>
            <CardHeader title="The crop now" subtitle="Live, from the room's sensor records (not part of the certificate)" />
            <div className="space-y-2 p-5 text-sm">
              <div className="flex items-center justify-between"><span className="text-ink-2">Status</span>{c.batchNow.status === 'stored' ? <Badge tone="brand">In the cold room</Badge> : <Badge>Taken out</Badge>}</div>
              <div className="flex items-center justify-between"><span className="text-ink-2">Freshness so far</span><FreshnessBadge value={c.batchNow.freshness} /></div>
              <div className="flex items-center justify-between"><span className="text-ink-2">Outside range / no data</span><span className="tabular">{c.batchNow.minutesOutOfRange} / {c.batchNow.minutesNoData} min</span></div>
            </div>
          </Card>
          {c.otherCertificates.length > 0 && (
            <Card>
              <CardHeader title="Other certificates for this batch" />
              <ul className="divide-y divide-line">
                {c.otherCertificates.map((o: any) => (
                  <li key={o.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <Link href={`/certificates/${o.id}`} className="font-mono hover:underline">{o.id}</Link>
                    <span className="flex items-center gap-2">{o.revoked_at && <Badge tone="critical">Revoked</Badge>}<FreshnessBadge value={o.freshness} /></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <ActionDialog
        open={revoking}
        onClose={() => setRevoking(false)}
        title={`Revoke ${d.id}?`}
        description="The public check page will say “Revoked” with your reason, and the farmer is told. This cannot be undone; the farmer can issue a new certificate if the crop is fine."
        confirmLabel="Revoke certificate"
        danger
        reasonLabel="Reason (shown publicly)"
        minLength={10}
        onConfirm={async (reason) => {
          await api(`certificates/${d.id}/revoke`, { method: 'POST', body: { reason } });
          toast('Certificate revoked');
          await cert.reload();
        }}
      />
    </>
  );
}
