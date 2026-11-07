import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { TFunction } from 'i18next';
import QRCode from 'qrcode';
import { Platform } from 'react-native';

import { API_URL, photoUrl, type Certificate } from '@/api';
import { formatDate, formatDateTime, formatDuration, formatQuantity, formatTemp } from '@/i18n/format';

import { certificateResult } from './freshness';

/** Public page where anyone can check a certificate. In production this is the API's public address. */
export const verifyUrl = (id: string) => `${process.env.EXPO_PUBLIC_VERIFY_URL ?? API_URL}/verify/${id}`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Photos are embedded as data URIs: the PDF is rendered offline and must not depend on the
 * network once shared. A photo that cannot be fetched is left out rather than failing the PDF.
 */
async function embedPhotos(ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids.slice(0, 3)) {
    try {
      const res = await fetch(photoUrl(id, 'thumb'));
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      out.push(`data:${res.headers.get('content-type') ?? 'image/webp'};base64,${btoa(binary)}`);
    } catch {
      // Offline: the certificate is still valid without its photos.
    }
  }
  return out;
}

export async function certificateHtml(cert: Certificate, t: TFunction, lang: string): Promise<string> {
  const photos = await embedPhotos(cert.photos ?? []);
  const qr = await QRCode.toString(verifyUrl(cert.id), { type: 'svg', margin: 0, color: { dark: '#111A14', light: '#FFFFFF' } });
  const c = cert.conditions;
  const fresh = c.freshness === 'fresh';
  const neutral = c.freshness === 'unknown';
  const rows: [string, string][] = [
    [t('certificate.farmer'), cert.farmer.name],
    [t('certificate.product'), `${t(`crops.${cert.batch.crop}`)} · ${formatQuantity(cert.batch.quantity, cert.batch.unit, t)}`],
    [t('certificate.coldRoom'), `${cert.coldRoom.name}, ${cert.coldRoom.district}`],
    [t('certificate.storedSince'), formatDateTime(cert.batch.storedAt, lang)],
    [t('certificate.duration'), formatDuration(c.hoursStored, t)],
    [t('certificate.avgTemp'), formatTemp(c.avgTemp, lang)],
    [t('certificate.tempRange'), `${formatTemp(c.minTemp, lang)} – ${formatTemp(c.maxTemp, lang)}`],
    [t('certificate.avgHumidity'), c.avgHumidity === null ? '–' : `${c.avgHumidity}%`],
    [t('certificate.safeRange'), `${c.safeMin}–${c.safeMax}°C · ${c.humidityMin}–${c.humidityMax}%`],
    [t('certificate.noData'), t('certificate.minutes', { count: c.minutesNoData })],
  ];

  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  @page { margin: 32px; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111A14; margin: 0; }
  .sheet { border: 1px solid #E8EBE8; border-radius: 16px; padding: 36px; max-width: 640px; margin: 0 auto; }
  .brand { color: #0B5A2B; font-family: Georgia, 'Times New Roman', serif; font-size: 22px; }
  .brand small { display: block; color: #5E8C2E; font-family: inherit; letter-spacing: 6px; font-size: 11px; margin-top: 2px; }
  h1 { font-size: 24px; margin: 28px 0 4px; letter-spacing: -0.4px; }
  .muted { color: #5E6B62; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  td { padding: 10px 0; border-bottom: 1px solid #E8EBE8; font-size: 14px; }
  td:last-child { text-align: right; font-weight: 600; }
  .result { margin-top: 24px; padding: 14px 16px; border-radius: 12px; font-weight: 600;
            background: ${fresh ? '#EEF5F0' : neutral ? '#F7F8F7' : '#FFF4EC'}; color: ${fresh ? '#0B5A2B' : neutral ? '#5E6B62' : '#C2410C'}; }
  .foot { display: flex; align-items: center; gap: 20px; margin-top: 28px; }
  .qr { width: 96px; height: 96px; }
  .note { margin-top: 24px; font-size: 12px; color: #8E9991; }
  .photos { margin-top: 24px; }
  .photos .row { display: flex; gap: 10px; margin-top: 8px; }
  .photos img { width: 150px; height: 150px; object-fit: cover; border-radius: 10px; border: 1px solid #E8EBE8; }
</style></head><body><div class="sheet">
  <div class="brand">Harvest Hold<small>RWANDA</small></div>
  <h1>${esc(t('certificate.heading'))}</h1>
  <div class="muted">${esc(t('certificate.number'))} ${esc(cert.id)} · ${esc(t('certificate.issued', { date: formatDate(cert.issuedAt, lang) }))}</div>
  <table>${rows.map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
  ${photos.length ? `<div class="photos"><div class="muted">${esc(t('certificate.photos'))}</div><div class="row">${photos.map((src) => `<img src="${src}" alt=""/>`).join('')}</div></div>` : ''}
  <div class="result">${esc(t('certificate.result'))}: ${esc(certificateResult(c, t))}</div>
  <div class="foot"><div class="qr">${qr}</div><div class="muted">${esc(t('certificate.scan'))}<br/>${esc(verifyUrl(cert.id))}<br/><br/>${esc(t('certificate.issuedBy'))}</div></div>
  <div class="note">${esc(t('certificate.internal'))}</div>
</div></body></html>`;
}

/** Native: share a PDF file. Web: open the browser print dialog (save as PDF from there). */
export async function shareCertificate(cert: Certificate, t: TFunction, lang: string): Promise<void> {
  const html = await certificateHtml(cert, t, lang);
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing unavailable');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: t('certificate.title') });
}
