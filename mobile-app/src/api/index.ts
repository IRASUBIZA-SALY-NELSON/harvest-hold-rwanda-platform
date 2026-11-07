import { Platform } from 'react-native';

import { BATTERY_LOW_PERCENT } from './constants';
import { API_URL, ApiError, request, upload } from './client';
import type {
  AlertItem,
  Certificate,
  ColdRoom,
  ConditionSummary,
  CropId,
  Lang,
  Listing,
  ListingStatus,
  ListingView,
  Order,
  OrderView,
  PhotoKind,
  PublicUser,
  Reading,
  RegisterInput,
  StockBatch,
  StockCollection,
  StockMovement,
  StorageRequest,
  StorageCharges,
  Unit,
} from './types';

export * from './types';
export { ApiError, API_URL, onSessionExpired, setToken, subscribe } from './client';

/**
 * Everything the app reads or writes goes through these functions. User ids passed by the
 * screens are not sent: the server knows who is signed in from the session token.
 */

// ---------- Phone & PIN ----------

/** Normalises Rwandan mobile numbers to +2507XXXXXXXX. Returns null when invalid. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let local = digits;
  if (local.startsWith('250')) local = local.slice(3);
  if (local.startsWith('0')) local = local.slice(1);
  return /^7\d{8}$/.test(local) ? `+250${local}` : null;
}

export function formatPhone(phone: string): string {
  const m = phone.match(/^\+250(\d{3})(\d{3})(\d{3})$/);
  return m ? `+250 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

export const isValidPin = (pin: string) => /^\d{4}$/.test(pin);

// ---------- Auth ----------

export interface Session {
  token: string;
  user: PublicUser;
}

export const signIn = (phone: string, pin: string) => request<Session>('POST', '/auth/sign-in', { phone, pin });
export const register = (input: RegisterInput) => request<Session>('POST', '/auth/register', input);
export const signOut = () => request<void>('POST', '/auth/sign-out');
export const getMe = () => request<PublicUser>('GET', '/me');
export const setLanguage = (lang: Lang) => request<PublicUser>('PATCH', '/me', { lang });
export const registerPushToken = (token: string) => request<void>('POST', '/me/push-token', { token });

// ---------- Cold rooms ----------

export const listColdRooms = () => request<ColdRoom[]>('GET', '/cold-rooms');
export const getColdRoom = (id: string) => request<ColdRoom>('GET', `/cold-rooms/${id}`);

export type HistoryRange = '24h' | '7d';

/** Averages per time slot (30 min for 24 h, 3 h for 7 days), oldest first. Slots without data are left out. */
export const getHistory = (roomId: string, range: HistoryRange) => request<Reading[]>('GET', `/cold-rooms/${roomId}/history?range=${range}`);

export interface ColdRoomStatus {
  room: ColdRoom;
  /** Latest reading, or null if the controller has never reported. */
  reading: Reading | null;
  /** Conditions over the last 24 hours. */
  last24h: ConditionSummary;
  storedCrates: number;
  /** Peltier rooms: energy the cooler used since midnight, Wh (null without a power meter). */
  energyTodayWh: number | null;
}

export const getColdRoomStatus = (roomId: string) => request<ColdRoomStatus>('GET', `/cold-rooms/${roomId}/status`);

export const isBatteryLow = (r: Reading) => r.battery !== null && r.battery <= BATTERY_LOW_PERCENT;

// ---------- Stock ----------

export interface StockItem {
  batch: StockBatch;
  conditions: ConditionSummary;
  listing: Listing | null;
  /** Where it is kept. */
  coldRoom?: { id: string; name: string; district: string; sector: string };
  /** What the QR code opens: a public page with the batch's record. */
  traceUrl?: string;
  charges?: StorageCharges;
  history?: { movements: StockMovement[]; collections: StockCollection[] };
}

export interface ChargesSummary {
  currency: 'RWF';
  rateSet: boolean;
  runningRwf: number;
  collectedRwf: number;
  paidRwf: number;
  dueRwf: number;
  totalRwf: number;
}

/** What the farmer owes for storage, in total. */
export const getCharges = () => request<ChargesSummary>('GET', '/stock/charges');

export const listStock = (_farmerId?: string) => request<StockItem[]>('GET', '/stock');
export const getStockItem = (batchId: string) => request<StockItem>('GET', `/stock/${batchId}`);

export interface StorageRequestInput {
  crop: CropId;
  /** The farmer's own estimate: the operator weighs it and confirms the real quantity. */
  quantity: number;
  unit: Unit;
  note?: string;
}

/** Asks to store produce. An operator at the cold room weighs it and registers what was really received. */
export const requestStorage = (input: StorageRequestInput) => request<StorageRequest>('POST', '/storage-requests', input);
export const listStorageRequests = () => request<StorageRequest[]>('GET', '/storage-requests');
export const cancelStorageRequest = (id: string) => request<StorageRequest>('POST', `/storage-requests/${id}/cancel`);

/** The farmer asks for the produce to be collected. Staff record the collection and the storage charge. */
export const requestCollection = (batchId: string) => request<void>('POST', `/stock/${batchId}/request-collection`);

// ---------- Certificates ----------

/** The latest certificate of a batch, or null if none was issued yet. */
export async function getCertificate(batchId: string): Promise<Certificate | null> {
  try {
    return await request<Certificate>('GET', `/stock/${batchId}/certificate`);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'noCertificate') return null;
    throw e;
  }
}

/** Issues a new certificate: a fixed record of the conditions from storage until now. */
export const issueCertificate = (batchId: string) => request<Certificate>('POST', `/stock/${batchId}/certificates`);

// ---------- Listings ----------

export interface BrowseFilters {
  query?: string;
  crop?: CropId | null;
  district?: string | null;
  /** Translated crop names, so search works in the user's language. */
  cropLabel?: (crop: CropId) => string;
}

export async function browseListings(filters: BrowseFilters = {}): Promise<ListingView[]> {
  const params = new URLSearchParams();
  if (filters.crop) params.set('crop', filters.crop);
  if (filters.district) params.set('district', filters.district);
  const listings = await request<ListingView[]>('GET', `/listings?${params}`);
  const q = filters.query?.trim().toLowerCase() ?? '';
  if (!q) return listings;
  return listings.filter((l) =>
    [l.crop, filters.cropLabel?.(l.crop) ?? '', l.farmer.name, l.coldRoom.name, l.coldRoom.district].join(' ').toLowerCase().includes(q)
  );
}

export const getListing = (id: string) => request<ListingView>('GET', `/listings/${id}`);
export const myListings = (_farmerId?: string) => request<ListingView[]>('GET', '/my/listings');

export interface CreateListingInput {
  batchId: string;
  quantity: number;
  pricePerUnit: number;
}

export const createListing = (_farmerId: string, input: CreateListingInput) => request<Listing>('POST', '/listings', input);

export const updateListing = (
  _farmerId: string,
  listingId: string,
  changes: { status?: Exclude<ListingStatus, 'soldOut'>; pricePerUnit?: number }
) => request<void>('PATCH', `/listings/${listingId}`, changes);

// ---------- Orders ----------

export const orderTotal = (o: Pick<Order, 'quantity' | 'pricePerUnit'>) => o.quantity * o.pricePerUnit;

export const placeOrder = (_buyerId: string, input: { listingId: string; quantity: number; note?: string }) =>
  request<Order>('POST', '/orders', input);
export const ordersForUser = (_user?: PublicUser) => request<OrderView[]>('GET', '/orders');
export const getOrder = (id: string) => request<OrderView>('GET', `/orders/${id}`);

/** Farmer accepts or declines. Accepting removes the quantity from the listing and the stored batch. */
export const respondToOrder = (_farmerId: string, orderId: string, accept: boolean) =>
  request<void>('POST', `/orders/${orderId}/respond`, { accept });
export const cancelOrder = (_buyerId: string, orderId: string) => request<void>('POST', `/orders/${orderId}/cancel`);

// ---------- Photos ----------

/** Photo files are public links with unguessable ids, so images load without the session token. */
export const photoUrl = (id: string, size: 'full' | 'thumb' = 'full') => `${API_URL}/media/${id}${size === 'thumb' ? '?size=thumb' : ''}`;

/**
 * Uploads a local image (file:// or, on web, blob:/data: URI). The server checks it really is an
 * image, resizes it and removes its metadata, including the GPS position.
 * `entityId` is the listing or batch id; a profile photo needs none and replaces the old one.
 */
export async function uploadPhoto(kind: PhotoKind, uri: string, entityId?: string): Promise<{ id: string }> {
  const form = new FormData();
  form.append('kind', kind);
  if (entityId) form.append('entityId', entityId);
  if (Platform.OS === 'web') {
    form.append('file', await (await fetch(uri)).blob(), 'photo.jpg');
  } else {
    // React Native's FormData streams the file from disk.
    form.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  }
  return upload<{ id: string }>('/photos', form);
}

export const deletePhoto = (id: string) => request<void>('DELETE', `/photos/${id}`);

// ---------- Alerts ----------

export const listAlerts = (_userId?: string) => request<AlertItem[]>('GET', '/alerts');
export const unreadAlertCount = async (_userId?: string) => (await request<{ count: number }>('GET', '/alerts/unread-count')).count;
export const markAlertRead = (_userId: string, alertId: string) => request<void>('POST', `/alerts/${alertId}/read`);
export const markAllAlertsRead = (_userId?: string) => request<void>('POST', '/alerts/read-all');
