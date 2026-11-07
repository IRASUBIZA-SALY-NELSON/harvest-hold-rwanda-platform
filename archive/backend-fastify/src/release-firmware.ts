/**
 * Publishes a firmware build for over-the-air updates:
 *   npm run firmware:release -- <path to harvest_hold_controller.ino.bin> <version> ["notes"]
 * <version> must match FW_VERSION in the firmware's config.h and be higher than any release so far.
 * Controllers check every 6 hours and install it; a version that fails is rolled back on the device.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { config } from './config.js';
import { one, pool, query } from './db.js';
import { migrate } from './migrate.js';

const [file, versionArg, notes = ''] = process.argv.slice(2);
const version = Number(versionArg);
if (!file || !Number.isInteger(version) || version < 1) {
  console.error('Usage: npm run firmware:release -- <firmware.bin> <version> ["notes"]');
  process.exit(1);
}

const data = fs.readFileSync(file);
// An ESP32 app image starts with the magic byte 0xE9.
if (data[0] !== 0xe9) {
  console.error(`${file} does not look like an ESP32 firmware image (.ino.bin)`);
  process.exit(1);
}

await migrate(() => {});
const latest = await one<{ version: number }>('SELECT max(version) AS version FROM firmware_releases');
if (latest?.version && version <= latest.version) {
  console.error(`Version ${version} is not higher than the latest release (${latest.version}).`);
  process.exit(1);
}

const sha256 = crypto.createHash('sha256').update(data).digest('hex');
const fileName = `harvest-hold-v${version}.bin`;
fs.mkdirSync(config.firmwareDir, { recursive: true });
fs.writeFileSync(path.join(config.firmwareDir, fileName), data);
await query('INSERT INTO firmware_releases (version, file_name, size, sha256, notes) VALUES ($1, $2, $3, $4, $5)', [
  version,
  fileName,
  data.length,
  sha256,
  notes,
]);
console.log(`Released firmware v${version}: ${data.length} bytes, sha256 ${sha256}`);
await pool.end();
