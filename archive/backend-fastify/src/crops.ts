import fs from 'node:fs';
import path from 'node:path';

import { query, type Db, pool } from './db.js';

export interface CropProfile {
  crop: string;
  version: number;
  controller: Record<string, number | string>;
  app: {
    safeMin: number;
    safeMax: number;
    humidityMin: number;
    humidityMax: number;
    excursionGraceMin: number;
    humidityGraceMin: number;
  };
  compatible_in_same_room: string[];
}

export type RoomConditions = CropProfile['app'];

let cache = new Map<string, CropProfile>();

function validate(p: any, file: string): CropProfile {
  const a = p?.app;
  const ok =
    typeof p?.crop === 'string' &&
    Number.isInteger(p?.version) &&
    p?.controller?.crop === p.crop &&
    a && [a.safeMin, a.safeMax, a.humidityMin, a.humidityMax, a.excursionGraceMin, a.humidityGraceMin].every(Number.isFinite) &&
    a.safeMin < a.safeMax && a.humidityMin < a.humidityMax &&
    Array.isArray(p.compatible_in_same_room);
  if (!ok) throw new Error(`Invalid crop profile ${file}`);
  return p as CropProfile;
}

/** Loads crop-profiles/*.json into the database (insert or update). Run at every start. */
export async function syncCropProfiles(dir: string, db: Db = pool): Promise<string[]> {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  const crops: string[] = [];
  for (const file of files) {
    const profile = validate(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), file);
    await query(
      `INSERT INTO crop_profiles (crop, version, data) VALUES ($1, $2, $3)
       ON CONFLICT (crop) DO UPDATE SET version = EXCLUDED.version, data = EXCLUDED.data, updated_at = now()
       WHERE crop_profiles.data IS DISTINCT FROM EXCLUDED.data`,
      [profile.crop, profile.version, profile],
      db
    );
    crops.push(profile.crop);
  }
  cache = new Map();
  return crops;
}

export async function getProfile(crop: string, db: Db = pool): Promise<CropProfile> {
  const hit = cache.get(crop);
  if (hit) return hit;
  const rows = await query<{ data: CropProfile }>('SELECT data FROM crop_profiles WHERE crop = $1', [crop], db);
  if (!rows[0]) throw new Error(`No crop profile for ${crop}`);
  cache.set(crop, rows[0].data);
  return rows[0].data;
}

/** A crop may go into a room if it is the room's crop or listed as compatible with it. */
export function canShareRoom(roomProfile: CropProfile, crop: string): boolean {
  return crop === roomProfile.crop || roomProfile.compatible_in_same_room.includes(crop);
}
