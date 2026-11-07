/** Simulated controller readings for development (same shape the ESP32 uploads). */

const HOUR = 3_600_000;
const MINUTE = 60_000;

function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

function roomSeed(roomId: string): number {
  let h = 0;
  for (let i = 0; i < roomId.length; i++) h = (h * 31 + roomId.charCodeAt(i)) % 9973;
  return h;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `warm` simulates a failure (chamber well above target). */
export function simulatedReading(roomId: string, target: number, time: number, warm = false) {
  const seed = roomSeed(roomId);
  const bucket = Math.floor(time / (2 * MINUTE)) + seed;
  const hour = (((time / HOUR + 2) % 24) + 24) % 24; // Kigali is UTC+2
  const dayWave = Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  const outside = 19 + 6 * dayWave + noise(bucket) * 1.2;
  const sunUp = hour >= 6.5 && hour <= 17.5;
  const solarCharging = sunUp && noise(Math.floor(time / HOUR) + seed * 7) <= 0.32;
  const battery = clamp(68 + 24 * Math.sin(((hour - 10) / 24) * 2 * Math.PI) + noise(bucket + 3) * 3, 5, 100);
  const iceBank = -1.5 + 1.8 * clamp(-dayWave, 0, 1) + noise(bucket + 5) * 0.3;
  const compressor = solarCharging && battery > 40;

  // Pump + fan cycle about every 40 min to hold the target.
  const cycle = ((time / MINUTE + seed) % 40) / 40;
  const cooling = cycle < 0.45;
  let chamber = target + (cooling ? 0.6 - cycle * 2.4 : -0.45 + (cycle - 0.45) * 2) + noise(bucket + 9) * 0.25;
  let humidity = 94 + noise(bucket + 11) * 3;
  if (warm) {
    chamber = target + 6 + noise(bucket + 13) * 0.8;
    humidity = 84 + noise(bucket + 15) * 2;
  }
  const pump = cooling || warm;
  return {
    chamber: round1(chamber),
    coilOutlet: round1(chamber - (pump ? 1.4 : 0.3)),
    product: round1(chamber + 0.4),
    humidity: Math.round(humidity),
    iceBank: round1(iceBank),
    outside: round1(outside),
    battery: Math.round(battery),
    batteryV: round1(11.8 + battery * 0.0105),
    solarV: solarCharging ? 18.5 : 0.4,
    solarCharging,
    pump,
    fan: pump,
    compressor,
    humidifier: false,
    door: 'closed',
    alerts: [] as string[],
  };
}

/**
 * Simulated Peltier prototype: power follows the outside temperature, the hot side warms with
 * power. `fault` simulates a dead hot-side fan: full power, hot side overheating, chamber warming.
 */
export function simulatedPeltierReading(roomId: string, target: number, time: number, fault = false) {
  const seed = roomSeed(roomId);
  const bucket = Math.floor(time / (2 * MINUTE)) + seed;
  const hour = (((time / HOUR + 2) % 24) + 24) % 24;
  const dayWave = Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  const outside = 19 + 6 * dayWave + noise(bucket) * 1.2;
  const sunUp = hour >= 6.5 && hour <= 17.5;
  const solarCharging = sunUp && noise(Math.floor(time / HOUR) + seed * 7) <= 0.32;
  const battery = clamp(70 + 22 * Math.sin(((hour - 11) / 24) * 2 * Math.PI) + noise(bucket + 3) * 3, 5, 100);

  // A PI-controlled Peltier holds the chamber close to target; it works harder when it is warm outside.
  let duty = clamp(28 + (outside - 15) * 4.5 + noise(bucket + 7) * 8, 15, 100);
  let chamber = target + noise(bucket + 9) * 0.5 + (duty > 95 ? 0.6 : 0);
  let hotSide = outside + 6 + duty * 0.22 + noise(bucket + 11);
  let humidity = 94 + noise(bucket + 13) * 3;
  if (fault) {
    duty = 100;
    chamber = target + 6 + noise(bucket + 15) * 0.8;
    hotSide = 62 + noise(bucket + 17) * 2;
    humidity = 86 + noise(bucket + 19) * 2;
  }
  const current = (duty / 100) * 5.6;
  return {
    chamber: round1(chamber),
    coilOutlet: round1(chamber - 0.6 - duty * 0.02),
    product: round1(chamber + 0.3),
    humidity: Math.round(humidity),
    hotSide: round1(hotSide),
    outside: round1(outside),
    battery: Math.round(battery),
    batteryV: round1(11.8 + battery * 0.0105),
    solarV: solarCharging ? 18.5 : 0.4,
    solarCharging,
    coolerDuty: Math.round(duty),
    coolerCurrent: Math.round(current * 100) / 100,
    coolerVoltage: 12.2,
    hotFan: true,
    fan: true,
    humidifier: false,
    door: 'closed',
    alerts: (fault ? ['hot_side_overheat'] : []) as string[],
  };
}
