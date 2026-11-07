import path from 'node:path';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const production = process.env.NODE_ENV === 'production';

export const config = {
  production,
  test: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required('DATABASE_URL'),
  publicBaseUrl: required('PUBLIC_BASE_URL', 'http://localhost:4000').replace(/\/$/, ''),
  secret: required('SECRET', production ? undefined : 'dev-secret-dev-secret-dev-secret-dev'),
  cropProfilesDir: path.resolve(process.env.CROP_PROFILES_DIR ?? '../crop-profiles'),
  firmwareDir: path.resolve(process.env.FIRMWARE_DIR ?? './firmware-releases'),
  uploadsDir: path.resolve(process.env.UPLOADS_DIR ?? './uploads'),
  /** Origin of the admin portal (Next.js). Only it may call /admin with cookies. */
  adminOrigin: process.env.ADMIN_ORIGIN ?? 'http://localhost:3000',
  /**
   * MQTT: a second way for controllers to reach the platform. OFF by default: HTTPS is the road in use.
   * Switch it on (MQTT_ENABLED=true) when there are more rooms or instant commands are needed.
   * The broker runs inside the API. A controller signs in with its room id and device token and may
   * only use topics under hhr/<room id>/. Use TLS (MQTT_TLS_PORT with a certificate) over the internet.
   */
  mqtt: {
    enabled: process.env.MQTT_ENABLED === 'true',
    host: process.env.MQTT_HOST ?? '0.0.0.0',
    /** Plain TCP. Refused in production unless MQTT_ALLOW_PLAIN=true (TLS ends at a proxy in front). */
    port: Number(process.env.MQTT_PORT ?? 1883),
    allowPlain: process.env.MQTT_ALLOW_PLAIN === 'true' || !production,
    tlsPort: Number(process.env.MQTT_TLS_PORT ?? 8883),
    tlsCert: process.env.MQTT_TLS_CERT ?? '',
    tlsKey: process.env.MQTT_TLS_KEY ?? '',
  },
  sms: {
    driver: (process.env.SMS_DRIVER ?? 'console') as 'console' | 'africastalking' | 'none',
    atUsername: process.env.AT_USERNAME ?? 'sandbox',
    atApiKey: process.env.AT_API_KEY ?? '',
    atSenderId: process.env.AT_SENDER_ID ?? '',
    atSandbox: process.env.AT_SANDBOX !== 'false',
  },
};

if (production && config.secret.length < 32) throw new Error('SECRET must be at least 32 characters in production');
if (production && config.mqtt.enabled && !config.mqtt.allowPlain && !(config.mqtt.tlsCert && config.mqtt.tlsKey)) {
  throw new Error('MQTT needs MQTT_TLS_CERT and MQTT_TLS_KEY in production (or MQTT_ALLOW_PLAIN=true behind a TLS proxy, or MQTT_ENABLED=false)');
}
if (production && config.sms.driver === 'console') throw new Error('SMS_DRIVER=console is not allowed in production');

/** Rules shared by the API, alerts and certificates. */
export const rules = {
  /** A reading covers at most this long; longer gaps count as "no data". */
  maxReadingGapMin: 5,
  /** Controllers send stored readings when they get back online: accept them up to this old. */
  maxReadingAgeDays: 14,
  /** Controller clocks may run a little ahead. */
  maxReadingAheadMin: 5,
  /** Only readings this recent can raise live alerts (an old backlog must not). */
  liveReadingMin: 5,
  /** The room is "online" if its last reading is newer than this. */
  onlineWindowMin: 5,
  /** Raise an "offline" alert after this long without data. */
  offlineAlertMin: 10,
  /** Freezing risk is announced after this long below the safe range. */
  coldAlertMin: 10,
  batteryLowPercent: 25,
  batteryOkPercent: 35,
  /** Peltier hot side: above this the controller is already reducing power. */
  hotSideAlertC: 55,
  /** After this many wrong PINs in a row the account is locked until an administrator reactivates it. */
  pin: { maxFailures: 5 },
  sessionDays: 90,
  admin: {
    sessionHours: 12,
    /** Wrong passwords or codes before an admin account is locked (another admin unlocks it). */
    maxFailures: 5,
  },
  commands: {
    /** A command not delivered within this time is dropped: a room that was offline must not act on old orders. */
    deliverWithinMin: 10,
    /** Longest an override may run before the room returns to automatic control. */
    maxMinutes: { set_target: 1440, cooling: 1440, inside_fan: 1440, hot_fan: 1440 },
    /** The controller keeps at least this distance from its alarm limits when the target is changed remotely. */
    targetMarginC: 0.5,
  },
  storage: {
    /** Kg per crate, used to count kg as crates. */
    kgPerCrate: 20,
    unitsKigaliOffsetMs: 2 * 3_600_000,
  },
  photos: {
    maxBytes: 12 * 1024 * 1024,
    maxPerListing: 4,
    maxPerBatch: 3,
  },
};
