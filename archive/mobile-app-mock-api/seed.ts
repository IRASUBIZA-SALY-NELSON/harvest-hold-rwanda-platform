import type { Incident } from './telemetry';
import type { AlertItem, ColdRoom, Listing, Order, StockBatch, User } from './types';

export interface Database {
  version: number;
  seededAt: string;
  users: User[];
  coldRooms: ColdRoom[];
  batches: StockBatch[];
  listings: Listing[];
  orders: Order[];
  alerts: AlertItem[];
  incidents: Incident[];
}

export const DB_VERSION = 1;

/** Demo accounts (also documented in the README). */
export const DEMO_FARMER_PHONE = '+250788123456';
export const DEMO_BUYER_PHONE = '+250788654321';
export const DEMO_PIN = '1234';

const HOUR = 3_600_000;

export function createSeed(now = Date.now()): Database {
  const ago = (hours: number) => new Date(now - hours * HOUR).toISOString();

  const coldRooms: ColdRoom[] = [
    {
      id: 'cr-musanze',
      name: 'Kinigi Cold Hub',
      district: 'Musanze',
      sector: 'Kinigi',
      safeMin: 4,
      safeMax: 10,
      humidityMin: 85,
      humidityMax: 95,
      capacityCrates: 120,
    },
    {
      id: 'cr-bugesera',
      name: 'Nyamata Cold Hub',
      district: 'Bugesera',
      sector: 'Nyamata',
      safeMin: 4,
      safeMax: 10,
      humidityMin: 85,
      humidityMax: 95,
      capacityCrates: 80,
    },
  ];

  const users: User[] = [
    {
      id: 'u-farmer-1',
      role: 'farmer',
      name: 'Jean Bosco Habimana',
      phone: DEMO_FARMER_PHONE,
      pin: DEMO_PIN,
      district: 'Musanze',
      coldRoomId: 'cr-musanze',
      createdAt: ago(24 * 40),
    },
    {
      id: 'u-farmer-2',
      role: 'farmer',
      name: 'Aline Uwase',
      phone: '+250788200300',
      pin: DEMO_PIN,
      district: 'Bugesera',
      coldRoomId: 'cr-bugesera',
      createdAt: ago(24 * 30),
    },
    {
      id: 'u-farmer-3',
      role: 'farmer',
      name: 'Eric Niyonzima',
      phone: '+250788400500',
      pin: DEMO_PIN,
      district: 'Musanze',
      coldRoomId: 'cr-musanze',
      createdAt: ago(24 * 22),
    },
    {
      id: 'u-buyer-1',
      role: 'buyer',
      name: 'Diane Mukamana',
      phone: DEMO_BUYER_PHONE,
      pin: DEMO_PIN,
      district: 'Gasabo',
      businessName: 'Kigali Hills Hotel',
      businessType: 'hotel',
      createdAt: ago(24 * 20),
    },
  ];

  const batches: StockBatch[] = [
    { id: 'b-101', farmerId: 'u-farmer-1', coldRoomId: 'cr-musanze', crop: 'tomato', quantity: 18, unit: 'crate', storedAt: ago(52), status: 'stored' },
    { id: 'b-102', farmerId: 'u-farmer-1', coldRoomId: 'cr-musanze', crop: 'carrot', quantity: 240, unit: 'kg', storedAt: ago(30), status: 'stored' },
    { id: 'b-103', farmerId: 'u-farmer-1', coldRoomId: 'cr-musanze', crop: 'cabbage', quantity: 12, unit: 'crate', storedAt: ago(8), status: 'stored' },
    { id: 'b-104', farmerId: 'u-farmer-1', coldRoomId: 'cr-musanze', crop: 'spinach', quantity: 6, unit: 'crate', storedAt: ago(24 * 9), status: 'removed' },
    { id: 'b-201', farmerId: 'u-farmer-2', coldRoomId: 'cr-bugesera', crop: 'pepper', quantity: 150, unit: 'kg', storedAt: ago(40), status: 'stored' },
    { id: 'b-202', farmerId: 'u-farmer-2', coldRoomId: 'cr-bugesera', crop: 'greenBeans', quantity: 10, unit: 'crate', storedAt: ago(6), status: 'stored' },
    { id: 'b-301', farmerId: 'u-farmer-3', coldRoomId: 'cr-musanze', crop: 'avocado', quantity: 20, unit: 'crate', storedAt: ago(70), status: 'stored' },
    { id: 'b-302', farmerId: 'u-farmer-3', coldRoomId: 'cr-musanze', crop: 'passionFruit', quantity: 90, unit: 'kg', storedAt: ago(20), status: 'stored' },
  ];

  const listings: Listing[] = [
    { id: 'l-101', batchId: 'b-101', farmerId: 'u-farmer-1', coldRoomId: 'cr-musanze', crop: 'tomato', quantity: 10, unit: 'crate', pricePerUnit: 14000, status: 'active', createdAt: ago(48) },
    { id: 'l-102', batchId: 'b-102', farmerId: 'u-farmer-1', coldRoomId: 'cr-musanze', crop: 'carrot', quantity: 200, unit: 'kg', pricePerUnit: 450, status: 'active', createdAt: ago(28) },
    { id: 'l-201', batchId: 'b-201', farmerId: 'u-farmer-2', coldRoomId: 'cr-bugesera', crop: 'pepper', quantity: 150, unit: 'kg', pricePerUnit: 900, status: 'active', createdAt: ago(36) },
    { id: 'l-202', batchId: 'b-202', farmerId: 'u-farmer-2', coldRoomId: 'cr-bugesera', crop: 'greenBeans', quantity: 10, unit: 'crate', pricePerUnit: 22000, status: 'active', createdAt: ago(5) },
    { id: 'l-301', batchId: 'b-301', farmerId: 'u-farmer-3', coldRoomId: 'cr-musanze', crop: 'avocado', quantity: 20, unit: 'crate', pricePerUnit: 18000, status: 'active', createdAt: ago(60) },
    { id: 'l-302', batchId: 'b-302', farmerId: 'u-farmer-3', coldRoomId: 'cr-musanze', crop: 'passionFruit', quantity: 90, unit: 'kg', pricePerUnit: 1200, status: 'active', createdAt: ago(18) },
  ];

  const orders: Order[] = [
    {
      id: 'o-5001',
      listingId: 'l-101',
      buyerId: 'u-buyer-1',
      farmerId: 'u-farmer-1',
      crop: 'tomato',
      quantity: 4,
      unit: 'crate',
      pricePerUnit: 14000,
      note: 'Pickup on Thursday morning, please.',
      status: 'pending',
      createdAt: ago(3),
      updatedAt: ago(3),
    },
    {
      id: 'o-5000',
      listingId: 'l-301',
      buyerId: 'u-buyer-1',
      farmerId: 'u-farmer-3',
      crop: 'avocado',
      quantity: 5,
      unit: 'crate',
      pricePerUnit: 18000,
      note: '',
      status: 'accepted',
      createdAt: ago(30),
      updatedAt: ago(26),
    },
  ];

  const incidents = [{ roomId: 'cr-bugesera', start: ago(27), end: ago(24.5) }];

  const alerts: AlertItem[] = [
    { id: 'a-1', userId: 'u-farmer-1', type: 'orderNew', createdAt: ago(3), read: false, params: { buyer: 'Kigali Hills Hotel', quantity: 4, unit: 'crate', crop: 'tomato' }, link: '/order/o-5001' },
    { id: 'a-2', userId: 'u-farmer-1', type: 'batteryLow', createdAt: ago(14), read: false, params: { room: 'Kinigi Cold Hub', battery: 23 } },
    { id: 'a-3', userId: 'u-farmer-1', type: 'iceLow', createdAt: ago(20), read: true, params: { room: 'Kinigi Cold Hub' } },
    { id: 'a-4', userId: 'u-farmer-2', type: 'chamberWarm', createdAt: ago(27), read: false, params: { room: 'Nyamata Cold Hub', temp: 12.6, max: 10 } },
    { id: 'a-5', userId: 'u-farmer-2', type: 'backToNormal', createdAt: ago(24.5), read: false, params: { room: 'Nyamata Cold Hub' } },
    { id: 'a-6', userId: 'u-buyer-1', type: 'orderAccepted', createdAt: ago(26), read: true, params: { farmer: 'Eric Niyonzima', crop: 'avocado' }, link: '/order/o-5000' },
  ];

  return {
    version: DB_VERSION,
    seededAt: new Date(now).toISOString(),
    users,
    coldRooms,
    batches,
    listings,
    orders,
    alerts,
    incidents,
  };
}
