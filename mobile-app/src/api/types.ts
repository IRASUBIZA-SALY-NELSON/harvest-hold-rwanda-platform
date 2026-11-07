export type Role = 'farmer' | 'buyer';

export type CropId =
  | 'tomato'
  | 'carrot'
  | 'cabbage'
  | 'greenBeans'
  | 'avocado'
  | 'passionFruit'
  | 'pepper'
  | 'spinach'
  | 'eggplant'
  | 'mango';

export type Unit = 'kg' | 'crate';

export type BusinessType = 'hotel' | 'restaurant' | 'wholesaler' | 'exporter' | 'retailer';

export type Lang = 'rw' | 'en' | 'fr';

export interface User {
  id: string;
  /** Profile photo, or null. Show it with `photoUrl`. */
  photoId?: string | null;
  role: Role;
  name: string;
  /** Hidden from other users until there is an order between them. */
  phone?: string;
  district: string;
  createdAt: string;
  lang?: Lang;
  /** Farmers only: the cold room where they store produce. */
  coldRoomId?: string;
  /** Buyers only. */
  businessName?: string;
  businessType?: BusinessType;
}

export type PublicUser = User;

export type CoolingType = 'peltier' | 'ice_bank';

export interface ColdRoom {
  id: string;
  name: string;
  district: string;
  sector: string;
  /** Main crop: the safe ranges below come from its crop profile. */
  crop: CropId;
  /** "peltier" for the prototype, "ice_bank" for the full-size design. */
  coolingType: CoolingType;
  /** Safe chamber temperature range in °C. */
  safeMin: number;
  safeMax: number;
  /** Safe relative humidity range in %. */
  humidityMin: number;
  humidityMax: number;
  capacityCrates: number;
  /** Crops that may be stored in this room (the main crop plus compatible ones). */
  allowedCrops: CropId[];
}

/** A controller reading. A value is null when that sensor did not report. */
export interface Reading {
  at: string;
  chamber: number | null;
  /** Air leaving the cooling coil: the coldest spot. */
  coilOutlet?: number | null;
  /** Probe inside the produce. */
  product?: number | null;
  humidity: number | null;
  iceBank: number | null;
  outside: number | null;
  /** Battery charge 0–100. */
  battery: number | null;
  solarCharging: boolean;
  pump: boolean;
  fan: boolean;
  compressor: boolean;
  doorOpen?: boolean;
  /** Peltier rooms: hot-side heatsink temperature. */
  hotSide?: number | null;
  /** Peltier rooms: cooler power, % of maximum. */
  coolerDuty?: number | null;
  /** Peltier rooms: electrical power the cooler draws now, W (needs the power meter). */
  coolerPower?: number | null;
  hotFan?: boolean;
  /** Battery volts and solar panel volts, where installed. */
  batteryV?: number | null;
  solarV?: number | null;
  /** True when the reading comes from the development simulator, not a real controller. */
  simulated?: boolean;
  online: boolean;
}

export interface StockBatch {
  id: string;
  farmerId: string;
  coldRoomId: string;
  crop: CropId;
  quantity: number;
  unit: Unit;
  storedAt: string;
  status: 'stored' | 'removed';
  /** The batch's number, printed on its label and in its QR code. */
  code?: string;
  /** Calendar day, YYYY-MM-DD. */
  harvestDate?: string | null;
  /** Spot inside the cold room, e.g. "Rack B". */
  storageLocation?: string;
  initialQuantity?: number;
  removedAt?: string | null;
  /** In the room, collection asked for, or collected (by someone, or sold through the market). */
  collectionStatus?: 'stored' | 'requested' | 'collected';
  /** Check-in photos, oldest first. */
  photos?: string[];
}

export interface StorageRequest {
  id: string;
  coldRoomId: string;
  crop: CropId;
  unit: Unit;
  /** What the farmer asked to store. */
  estimatedQuantity: number;
  note: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  /** What the operator weighed and confirmed. */
  confirmedQuantity: number | null;
  batchId: string | null;
  batchCode: string | null;
  declineReason: string | null;
  createdAt: string;
  handledAt: string | null;
}

export interface StorageCharges {
  unit: Unit;
  /** RWF per unit per day. null until Harvest Hold sets a rate. */
  rateRwf: number | null;
  rateSet: boolean;
  days: number;
  /** Still stored: running charge so far. */
  runningRwf: number;
  /** Already collected: frozen charge. */
  collectedRwf: number;
  paidRwf: number;
  totalRwf: number;
  dueRwf: number;
}

export interface StockMovement {
  id: number;
  kind: 'in' | 'out';
  reason: 'checkin' | 'collection' | 'sale' | 'removed';
  quantity: number;
  unit: Unit;
  at: string;
  by: string | null;
  note: string;
}

export interface StockCollection {
  id: string;
  quantity: number;
  unit: Unit;
  collectedAt: string;
  collectedBy: string;
  kind: 'collection' | 'sale';
  days: number;
  rateRwf: number | null;
  chargeRwf: number | null;
  paymentStatus: 'unpaid' | 'paid' | 'waived';
}

/** "unknown": the controller sent no data for too long to be sure. */
export type Freshness = 'fresh' | 'attention' | 'unknown';

export interface ConditionSummary {
  freshness: Freshness;
  from: string;
  to: string;
  hoursStored: number;
  avgTemp: number | null;
  minTemp: number | null;
  maxTemp: number | null;
  avgHumidity: number | null;
  /** Minutes the chamber spent outside the safe range (only spells longer than the grace period). */
  minutesOutOfRange: number;
  /** Minutes the humidity spent outside its range (only long spells). */
  minutesHumidityOutOfRange: number;
  /** Minutes with no data from the controller. */
  minutesNoData: number;
  longestGapMinutes: number;
  samples: number;
  safeMin: number;
  safeMax: number;
  humidityMin: number;
  humidityMax: number;
}

/** A frozen record: issued once, never recalculated. */
export interface Certificate {
  id: string;
  batch: StockBatch;
  farmer: { id: string; name: string; district: string };
  coldRoom: ColdRoom;
  issuedAt: string;
  conditions: ConditionSummary;
  /** "internal" until RSB / NAEB approve the scheme. */
  status: 'internal' | 'certified';
  /** Check-in photos at the time of issue. */
  photos?: string[];
}

export type PhotoKind = 'listing' | 'checkin' | 'profile';

export type ListingStatus = 'active' | 'paused' | 'soldOut';

export interface Listing {
  id: string;
  batchId: string;
  farmerId: string;
  coldRoomId: string;
  crop: CropId;
  quantity: number;
  unit: Unit;
  pricePerUnit: number;
  status: ListingStatus;
  createdAt: string;
  /** The first one is the cover photo. */
  photos?: string[];
}

export interface ListingView extends Listing {
  farmer: PublicUser;
  coldRoom: ColdRoom;
  freshness: Freshness;
  /** Owner's own listings only: "hidden" when Harvest Hold took it off the market. */
  moderation?: 'visible' | 'hidden';
  moderationReason?: string | null;
  /** Buyers, on the listing page only: how to reach the seller. */
  contact?: { name: string; phone: string };
}

export type OrderStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export interface Order {
  id: string;
  listingId: string;
  buyerId: string;
  farmerId: string;
  crop: CropId;
  quantity: number;
  unit: Unit;
  pricePerUnit: number;
  note: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface OrderView extends Order {
  buyer: PublicUser;
  farmer: PublicUser;
  coldRoom: ColdRoom;
}

export type AlertType =
  | 'chamberWarm'
  | 'chamberCold'
  | 'coolerOverheat'
  | 'coolerFault'
  | 'coolingCapacity'
  | 'humidityLow'
  | 'backToNormal'
  | 'batteryLow'
  | 'iceLow'
  | 'offline'
  | 'storageAccepted'
  | 'storageDeclined'
  | 'orderNew'
  | 'orderAccepted'
  | 'orderDeclined'
  | 'orderCancelled';

export interface AlertItem {
  id: string;
  userId: string;
  type: AlertType;
  createdAt: string;
  read: boolean;
  /** Values interpolated into the translated message. */
  params: Record<string, string | number>;
  /** Optional in-app link target. */
  link?: string;
}

export interface RegisterInput {
  role: Role;
  name: string;
  phone: string;
  pin: string;
  lang?: Lang;
  district: string;
  coldRoomId?: string;
  businessName?: string;
  businessType?: BusinessType;
}
