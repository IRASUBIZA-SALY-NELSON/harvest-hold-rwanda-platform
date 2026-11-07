import type { BusinessType, CropId, Unit } from './types';

export const CROPS: CropId[] = [
  'tomato',
  'carrot',
  'cabbage',
  'greenBeans',
  'avocado',
  'passionFruit',
  'pepper',
  'spinach',
  'eggplant',
  'mango',
];

export const UNITS: Unit[] = ['crate', 'kg'];

export const BUSINESS_TYPES: BusinessType[] = [
  'hotel',
  'restaurant',
  'wholesaler',
  'exporter',
  'retailer',
];

/** The 30 districts of Rwanda. Proper names, not translated. */
export const DISTRICTS = [
  'Bugesera',
  'Burera',
  'Gakenke',
  'Gasabo',
  'Gatsibo',
  'Gicumbi',
  'Gisagara',
  'Huye',
  'Kamonyi',
  'Karongi',
  'Kayonza',
  'Kicukiro',
  'Kirehe',
  'Muhanga',
  'Musanze',
  'Ngoma',
  'Ngororero',
  'Nyabihu',
  'Nyagatare',
  'Nyamagabe',
  'Nyamasheke',
  'Nyanza',
  'Nyarugenge',
  'Nyaruguru',
  'Rubavu',
  'Ruhango',
  'Rulindo',
  'Rusizi',
  'Rutsiro',
  'Rwamagana',
] as const;

/** Chamber must stay out of range this long before freshness is affected. */
export const EXCURSION_GRACE_MINUTES = 30;

export const BATTERY_LOW_PERCENT = 25;
