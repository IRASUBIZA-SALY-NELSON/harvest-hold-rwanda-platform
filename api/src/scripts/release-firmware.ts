/**
 * Publishes a firmware build from the command line (the admin portal does the same):
 *   npm run firmware:release -- <harvest_hold_controller.ino.bin> <version> [stable|beta] ["notes"]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createApp } from '../bootstrap.js';
import { Database } from '../common/database.service.js';
import { config } from '../config.js';
import { AuditService, SYSTEM } from '../modules/audit/audit.service.js';

const [file, versionArg, channelArg = 'stable', notes = ''] = process.argv.slice(2);
const version = Number(versionArg);
const channel = channelArg === 'beta' ? 'beta' : 'stable';
if (!file || !Number.isInteger(version) || version < 1) {
  console.error('Usage: npm run firmware:release -- <firmware.bin> <version> [stable|beta] ["notes"]');
  process.exit(1);
}
const data = fs.readFileSync(file);
if (data[0] !== 0xe9) {
  console.error(`${file} does not look like an ESP32 firmware image (.ino.bin)`);
  process.exit(1);
}
const app = await createApp({ logger: false });
const db = app.get(Database);
const latest = await db.one<{ version: number | null }>('SELECT max(version) AS version FROM firmware_releases');
if (latest?.version && version <= latest.version) {
  console.error(`Version ${version} is not higher than the latest release (${latest.version}).`);
  await app.close();
  process.exit(1);
}
const sha256 = crypto.createHash('sha256').update(data).digest('hex');
const fileName = `harvest-hold-v${version}.bin`;
fs.mkdirSync(config.firmwareDir, { recursive: true });
fs.writeFileSync(path.join(config.firmwareDir, fileName), data);
await db.query('INSERT INTO firmware_releases (version, file_name, size, sha256, notes, channel) VALUES ($1, $2, $3, $4, $5, $6)', [version, fileName, data.length, sha256, notes, channel]);
await app.get(AuditService).record(SYSTEM, { action: 'firmware.release', entityType: 'firmware', entityId: String(version), summary: `Released firmware v${version} to ${channel} rooms from the command line` });
console.log(`Released firmware v${version} (${channel}): ${data.length} bytes, sha256 ${sha256}`);
await app.close();
