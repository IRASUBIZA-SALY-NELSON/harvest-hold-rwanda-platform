import type { TFunction } from 'i18next';

import type { ConditionSummary } from '@/api';

/** One sentence explaining a freshness result, shared by stock details, certificates and the PDF. */
export function freshnessExplanation(c: ConditionSummary, t: TFunction): string {
  if (c.freshness === 'fresh') return t('freshness.freshLong');
  if (c.freshness === 'unknown') return t('freshness.unknownLong', { minutes: c.longestGapMinutes });
  if (c.minutesOutOfRange > 0) return t('freshness.attentionLong', { minutes: c.minutesOutOfRange });
  return t('freshness.humidityLong', { minutes: c.minutesHumidityOutOfRange });
}

/** Result line on a certificate. */
export function certificateResult(c: ConditionSummary, t: TFunction): string {
  if (c.freshness === 'fresh') return t('certificate.resultFresh');
  if (c.freshness === 'unknown') return t('certificate.resultUnknown', { minutes: c.minutesNoData });
  if (c.minutesOutOfRange > 0) return t('certificate.resultAttention', { minutes: c.minutesOutOfRange });
  return t('certificate.resultHumidity', { minutes: c.minutesHumidityOutOfRange });
}
