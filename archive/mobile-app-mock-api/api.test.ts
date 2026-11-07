import { beforeEach, describe, expect, it } from '@jest/globals';

import * as api from '@/api';
import { configureStorage, memoryStorage } from '@/api/db';
import { DEMO_BUYER_PHONE, DEMO_FARMER_PHONE, DEMO_PIN } from '@/api/seed';

beforeEach(() => configureStorage(memoryStorage()));

describe('phone numbers', () => {
  it.each([
    ['0788123456', '+250788123456'],
    ['788123456', '+250788123456'],
    ['+250 788 123 456', '+250788123456'],
    ['250788123456', '+250788123456'],
  ])('normalises %s', (input, expected) => {
    expect(api.normalizePhone(input)).toBe(expected);
  });

  it.each(['12345', '0688123456', '07881234567', ''])('rejects %s', (input) => {
    expect(api.normalizePhone(input)).toBeNull();
  });

  it('formats for display', () => {
    expect(api.formatPhone('+250788123456')).toBe('+250 788 123 456');
  });
});

describe('auth', () => {
  it('signs in the demo farmer with a local-format number', async () => {
    const user = await api.signIn('0788123456', DEMO_PIN);
    expect(user.role).toBe('farmer');
    expect(user).not.toHaveProperty('pin');
  });

  it('rejects a wrong PIN', async () => {
    await expect(api.signIn(DEMO_FARMER_PHONE, '0000')).rejects.toMatchObject({ code: 'wrongCredentials' });
  });

  it('registers a buyer and refuses a duplicate phone', async () => {
    const input = {
      role: 'buyer' as const,
      name: 'Test Buyer',
      phone: '0781112223',
      pin: '4321',
      district: 'Huye',
      businessName: 'Huye Market',
      businessType: 'retailer' as const,
    };
    const user = await api.register(input);
    expect(user.phone).toBe('+250781112223');
    await expect(api.register(input)).rejects.toMatchObject({ code: 'phoneTaken' });
  });

  it('requires a cold room for farmers', async () => {
    await expect(
      api.register({ role: 'farmer', name: 'No Room', phone: '0781112224', pin: '1111', district: 'Huye' })
    ).rejects.toMatchObject({ code: 'coldRoomRequired' });
  });
});

describe('freshness', () => {
  it('marks stock stored before an incident as needing attention', async () => {
    const stock = await api.listStock('u-farmer-2');
    const pepper = stock.find((s) => s.batch.crop === 'pepper')!;
    const beans = stock.find((s) => s.batch.crop === 'greenBeans')!;
    expect(pepper.conditions.freshness).toBe('attention');
    expect(pepper.conditions.minutesOutOfRange).toBeGreaterThanOrEqual(30);
    // Stored after the incident ended.
    expect(beans.conditions.freshness).toBe('fresh');
  });

  it('keeps stock fresh in a healthy cold room', async () => {
    const stock = await api.listStock('u-farmer-1');
    stock.filter((s) => s.batch.status === 'stored').forEach((s) => expect(s.conditions.freshness).toBe('fresh'));
  });

  it('builds a certificate from the same conditions', async () => {
    const cert = await api.getCertificate('b-101');
    expect(cert.id).toMatch(/^HHR-101-\d{4}$/);
    expect(cert.conditions.freshness).toBe('fresh');
    expect(cert.conditions.minTemp).toBeGreaterThanOrEqual(cert.coldRoom.safeMin);
    expect(cert.conditions.maxTemp).toBeLessThanOrEqual(cert.coldRoom.safeMax);
  });
});

describe('stock', () => {
  it('adds stock to the farmer’s cold room', async () => {
    const batch = await api.addStock('u-farmer-1', { crop: 'mango', quantity: 5, unit: 'crate', storedAt: new Date().toISOString() });
    expect(batch.coldRoomId).toBe('cr-musanze');
    const stock = await api.listStock('u-farmer-1');
    expect(stock[0].batch.id).toBe(batch.id);
  });

  it('rejects zero quantity and future dates', async () => {
    await expect(
      api.addStock('u-farmer-1', { crop: 'mango', quantity: 0, unit: 'crate', storedAt: new Date().toISOString() })
    ).rejects.toMatchObject({ code: 'invalidQuantity' });
    await expect(
      api.addStock('u-farmer-1', { crop: 'mango', quantity: 1, unit: 'crate', storedAt: new Date(Date.now() + 86_400_000).toISOString() })
    ).rejects.toMatchObject({ code: 'futureDate' });
  });

  it('will not take out stock with waiting orders', async () => {
    await expect(api.removeStock('u-farmer-1', 'b-101')).rejects.toMatchObject({ code: 'hasPendingOrders' });
  });
});

describe('marketplace', () => {
  it('only shows active listings to buyers and filters by crop and search', async () => {
    const all = await api.browseListings();
    expect(all.length).toBe(6);
    expect(await api.browseListings({ crop: 'tomato' })).toHaveLength(1);
    expect(await api.browseListings({ district: 'Bugesera' })).toHaveLength(2);
    expect(await api.browseListings({ query: 'inyanya', cropLabel: (c) => (c === 'tomato' ? 'Inyanya' : c) })).toHaveLength(1);
  });

  it('does not allow listing the same batch twice or more than in stock', async () => {
    await expect(api.createListing('u-farmer-1', { batchId: 'b-101', quantity: 1, pricePerUnit: 100 })).rejects.toMatchObject({
      code: 'alreadyListed',
    });
    await expect(api.createListing('u-farmer-1', { batchId: 'b-103', quantity: 99, pricePerUnit: 100 })).rejects.toMatchObject({
      code: 'moreThanStock',
    });
  });

  it('runs a full order: list, order, accept, stock goes down', async () => {
    const listing = await api.createListing('u-farmer-1', { batchId: 'b-103', quantity: 12, pricePerUnit: 9000 });
    const buyer = await api.signIn(DEMO_BUYER_PHONE, DEMO_PIN);
    const order = await api.placeOrder(buyer.id, { listingId: listing.id, quantity: 12, note: 'Friday' });

    const farmerAlerts = await api.listAlerts('u-farmer-1');
    expect(farmerAlerts[0]).toMatchObject({ type: 'orderNew', link: `/order/${order.id}` });

    await api.respondToOrder('u-farmer-1', order.id, true);
    const after = await api.getListing(listing.id);
    expect(after.quantity).toBe(0);
    expect(after.status).toBe('soldOut');
    const batch = await api.getStockItem('b-103');
    expect(batch.batch.status).toBe('removed');

    const buyerAlerts = await api.listAlerts(buyer.id);
    expect(buyerAlerts[0].type).toBe('orderAccepted');
    await expect(api.respondToOrder('u-farmer-1', order.id, false)).rejects.toMatchObject({ code: 'orderNotPending' });
  });

  it('refuses orders above the available quantity and on paused listings', async () => {
    await expect(api.placeOrder('u-buyer-1', { listingId: 'l-101', quantity: 11 })).rejects.toMatchObject({
      code: 'moreThanAvailable',
    });
    await api.updateListing('u-farmer-1', 'l-101', { status: 'paused' });
    await expect(api.placeOrder('u-buyer-1', { listingId: 'l-101', quantity: 1 })).rejects.toMatchObject({
      code: 'listingUnavailable',
    });
  });

  it('lets a buyer cancel a waiting order and tells the farmer', async () => {
    await api.cancelOrder('u-buyer-1', 'o-5001');
    expect((await api.getOrder('o-5001')).status).toBe('cancelled');
    expect((await api.listAlerts('u-farmer-1'))[0].type).toBe('orderCancelled');
  });

  it('stops other users acting on an order', async () => {
    await expect(api.respondToOrder('u-farmer-2', 'o-5001', true)).rejects.toMatchObject({ code: 'notAllowed' });
  });
});

describe('alerts', () => {
  it('counts and clears unread alerts', async () => {
    expect(await api.unreadAlertCount('u-farmer-1')).toBe(2);
    await api.markAllAlertsRead('u-farmer-1');
    expect(await api.unreadAlertCount('u-farmer-1')).toBe(0);
  });
});
