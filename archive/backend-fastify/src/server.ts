import { buildApp } from './app.js';
import { config } from './config.js';
import { syncCropProfiles } from './crops.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { checkOffline } from './monitor.js';

await migrate();
const crops = await syncCropProfiles(config.cropProfilesDir);
console.log(`crop profiles: ${crops.join(', ') || 'none found in ' + config.cropProfilesDir}`);

const app = await buildApp();
await app.listen({ host: '0.0.0.0', port: config.port });
console.log(`Harvest Hold API on :${config.port} (SMS: ${config.sms.driver})`);

const timer = setInterval(() => checkOffline().catch((e) => app.log.error(e)), 60_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
