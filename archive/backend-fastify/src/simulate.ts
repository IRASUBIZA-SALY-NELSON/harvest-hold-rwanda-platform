/**
 * Pretends to be the ESP32 controllers: sends one reading per room every minute to the
 * real device endpoint, exactly like the firmware. Development only.
 *   npm run simulate             normal operation
 *   npm run simulate -- --warm   Kinigi's hot-side fan fails: overheating + warm chamber (to test alerts)
 * Kinigi is a Peltier prototype, Nyamata an ice-bank room.
 */
import { config } from './config.js';
import { simulatedPeltierReading, simulatedReading } from './sim.js';

const BASE = `http://127.0.0.1:${config.port}`;
const ROOMS: Record<string, string> = {
  'cr-musanze': 'dev-device-token-musanze',
  'cr-bugesera': 'dev-device-token-bugesera',
};
const warm = process.argv.includes('--warm');

async function tick() {
  for (const [room, token] of Object.entries(ROOMS)) {
    const reading = room === 'cr-musanze' ? simulatedPeltierReading(room, 2, Date.now(), warm) : simulatedReading(room, 2, Date.now());
    try {
      const res = await fetch(`${BASE}/devices/${room}/readings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        // Same format as the firmware: a batch with the controller's own timestamps.
        body: JSON.stringify({ readings: [{ ...reading, t: Math.floor(Date.now() / 1000), profileVersion: 2 }] }),
      });
      console.log(`${new Date().toLocaleTimeString()} ${room} chamber ${reading.chamber}°C → ${res.status}`);
    } catch (e) {
      console.log(`${room}: API not reachable (${(e as Error).message})`);
    }
  }
}

await tick();
setInterval(tick, 60_000);
