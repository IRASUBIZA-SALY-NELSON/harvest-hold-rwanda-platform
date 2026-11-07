import { afterEach, describe, expect, it, jest } from '@jest/globals';

import type { Certificate, ConditionSummary } from '@/api';
import i18n from '@/i18n';

import { certificateHtml, verifyUrl } from '../certificate-pdf';

const conditions = (c: Partial<ConditionSummary> = {}): ConditionSummary => ({
  freshness: 'fresh',
  from: '2026-10-30T08:00:00.000Z',
  to: '2026-10-31T08:00:00.000Z',
  hoursStored: 24,
  avgTemp: 2.1,
  minTemp: 1.4,
  maxTemp: 3.2,
  avgHumidity: 94,
  minutesOutOfRange: 0,
  minutesHumidityOutOfRange: 0,
  minutesNoData: 0,
  longestGapMinutes: 0,
  samples: 720,
  safeMin: 0,
  safeMax: 5,
  humidityMin: 90,
  humidityMax: 98,
  ...c,
});

const cert = (c: Partial<ConditionSummary> = {}): Certificate => ({
  id: 'HHR-KVPE-78US',
  issuedAt: '2026-10-31T08:00:00.000Z',
  status: 'internal',
  batch: { id: 'b-1', farmerId: 'u-1', coldRoomId: 'cr-1', crop: 'carrot', quantity: 240, unit: 'kg', storedAt: '2026-10-30T08:00:00.000Z', status: 'stored' },
  farmer: { id: 'u-1', name: 'Jean Bosco Habimana', district: 'Musanze' },
  coldRoom: {
    id: 'cr-1', name: 'Kinigi Cold Hub', district: 'Musanze', sector: 'Kinigi', crop: 'carrot', coolingType: 'peltier',
    safeMin: 0, safeMax: 5, humidityMin: 90, humidityMax: 98, capacityCrates: 120, allowedCrops: ['carrot'],
  },
  conditions: conditions(c),
});

describe('certificate PDF', () => {
  it('contains the details, the safe range, a QR code and the internal note', async () => {
    await i18n.changeLanguage('en');
    const c = cert();
    const html = await certificateHtml(c, i18n.t, 'en');
    expect(html).toContain(c.id);
    expect(html).toContain('Jean Bosco Habimana');
    expect(html).toContain('Carrots · 240 kg');
    expect(html).toContain('0–5°C · 90–98%');
    expect(html).toContain('Kept in the safe range the whole time');
    expect(html).toContain('<svg');
    expect(html).toContain(verifyUrl(c.id));
    expect(html).toContain('/verify/HHR-KVPE-78US');
    expect(html).toContain('Internal certificate');
  });

  it('says when freshness cannot be confirmed', async () => {
    await i18n.changeLanguage('en');
    const html = await certificateHtml(cert({ freshness: 'unknown', minutesNoData: 47, longestGapMinutes: 47 }), i18n.t, 'en');
    expect(html).toContain('Cannot confirm: 47 min without data');
  });

  it('reports long humidity problems', async () => {
    await i18n.changeLanguage('en');
    const html = await certificateHtml(cert({ freshness: 'attention', minutesHumidityOutOfRange: 148 }), i18n.t, 'en');
    expect(html).toContain('Humidity out of range for 148 min');
  });

  it('is translated', async () => {
    await i18n.changeLanguage('rw');
    const html = await certificateHtml(cert(), i18n.t, 'rw');
    expect(html).toContain('Karoti');
    expect(html).toContain('Byagumye ku bukonje bukwiye');
  });

  describe('check-in photos', () => {
    const realFetch = global.fetch;
    afterEach(() => {
      global.fetch = realFetch;
    });

    it('embeds them so the PDF works offline', async () => {
      await i18n.changeLanguage('en');
      const fetched: string[] = [];
      global.fetch = jest.fn(async (url: string | URL | Request) => {
        fetched.push(String(url));
        return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }));
      }) as unknown as typeof fetch;
      const html = await certificateHtml({ ...cert(), photos: ['ph-aaaaaaaaaaaa', 'ph-bbbbbbbbbbbb'] }, i18n.t, 'en');
      expect(fetched).toEqual([expect.stringContaining('/media/ph-aaaaaaaaaaaa?size=thumb'), expect.stringContaining('/media/ph-bbbbbbbbbbbb?size=thumb')]);
      expect(html).toContain('Photos at check-in');
      expect(html.match(/<img src="data:/g)).toHaveLength(2);
      expect(html).not.toContain('/media/');
    });

    it('leaves them out when they cannot be fetched', async () => {
      await i18n.changeLanguage('en');
      global.fetch = jest.fn(async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch;
      const html = await certificateHtml({ ...cert(), photos: ['ph-aaaaaaaaaaaa'] }, i18n.t, 'en');
      expect(html).not.toContain('<img');
      expect(html).toContain('Kept in the safe range the whole time');
    });
  });
});
