import { useTranslation } from 'react-i18next';

import { ApiError, type CropId, type Freshness, type ListingStatus, type OrderStatus } from '@/api';
import type { BadgeTone } from '@/ui';

/** Translation helpers shared by many screens. */
export function useLabels() {
  const { t, i18n } = useTranslation();
  return {
    t,
    lang: i18n.language,
    crop: (c: CropId) => t(`crops.${c}`),
    errorMessage: (e: unknown) =>
      e instanceof ApiError && i18n.exists(`errors.${e.code}`) ? t(`errors.${e.code}`) : t('errors.unknown'),
  };
}

export const freshnessTone = (f: Freshness): BadgeTone => (f === 'fresh' ? 'brand' : f === 'unknown' ? 'neutral' : 'warning');

export const orderTone = (s: OrderStatus): BadgeTone =>
  s === 'accepted' ? 'brand' : s === 'pending' ? 'warning' : 'neutral';

export const listingTone = (s: ListingStatus): BadgeTone => (s === 'active' ? 'brand' : 'neutral');
