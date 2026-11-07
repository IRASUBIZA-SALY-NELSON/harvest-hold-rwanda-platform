import path from 'node:path';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const production = process.env.NODE_ENV === 'production';

export const config = {
  production,
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  publicBaseUrl: required('PUBLIC_BASE_URL', 'http://localhost:4000').replace(/\/$/, ''),
  secret: required('SECRET', production ? undefined : 'dev-secret'),
  cropProfilesDir: path.resolve(process.env.CROP_PROFILES_DIR ?? '../crop-profiles'),
  firmwareDir: path.resolve(process.env.FIRMWARE_DIR ?? './firmware-releases'),
  sms: {
    driver: (process.env.SMS_DRIVER ?? 'console') as 'console' | 'africastalking' | 'none',
    atUsername: process.env.AT_USERNAME ?? 'sandbox',
    atApiKey: process.env.AT_API_KEY ?? '',
    atSenderId: process.env.AT_SENDER_ID ?? '',
    atSandbox: process.env.AT_SANDBOX !== 'false',
  },
};

if (production && config.secret.length < 32) throw new Error('SECRET must be at least 32 characters in production');
if (production && config.sms.driver === 'console') throw new Error('SMS_DRIVER=console is not allowed in production');

/** Rules shared by the API, alerts and certificates. */
export const rules = {
  /** Controllers send stored readings when they get back online: accept them up to this old. */
  maxReadingAgeDays: 14,
  /** Controller clocks may run a little ahead. */
  maxReadingAheadMin: 5,
  /** Only readings this recent can raise live alerts (an old backlog must not). */
  liveReadingMin: 5,
  /** A reading covers at most this long; longer gaps count as "no data". */
  maxReadingGapMin: 5,
  /** The room is "online" if its last reading is newer than this. */
  onlineWindowMin: 5,
  /** Raise an "offline" alert after this long without data. */
  offlineAlertMin: 10,
  /** Freezing risk is announced after this long below the safe range. */
  coldAlertMin: 10,
  batteryLowPercent: 25,
  /** Peltier hot side: above this the controller is already reducing power. */
  hotSideAlertC: 55,
  batteryOkPercent: 35,
  /** After this many wrong PINs in a row the account is locked until an administrator reactivates it. */
  pin: { maxFailures: 5 },
  sessionDays: 90,
};
