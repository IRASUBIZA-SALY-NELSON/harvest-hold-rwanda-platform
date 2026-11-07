import fs from 'node:fs';
import path from 'node:path';

import { Injectable } from '@nestjs/common';

import { Database, type Queryable } from '../../common/database.service.js';

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
  [key: string]: unknown;
}

export type RoomConditions = CropProfile['app'];

/** Throws when a profile could damage crops or equipment. Used for files and for admin edits. */
export function validateProfile(p: any, source = 'profile'): CropProfile {
  const a = p?.app;
  const c = p?.controller;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const ok =
    typeof p?.crop === 'string' &&
    Number.isInteger(p?.version) &&
    c?.crop === p.crop &&
    a && [a.safeMin, a.safeMax, a.humidityMin, a.humidityMax, a.excursionGraceMin, a.humidityGraceMin].every(num) &&
    a.safeMin < a.safeMax && a.humidityMin < a.humidityMax &&
    // Same bounds the firmware enforces (crop_profile.h: profileIsSafe).
    num(c.targetC) && c.targetC >= -0.5 && c.targetC <= 15 &&
    num(c.hysteresisC) && c.hysteresisC >= 0.2 && c.hysteresisC <= 3 &&
    num(c.freezeGuardC) && c.freezeGuardC >= -1 && c.freezeGuardC < c.targetC - c.hysteresisC &&
    num(c.alarmLowC) && num(c.alarmHighC) && c.alarmLowC < c.targetC && c.alarmHighC > c.targetC &&
    num(c.rhLow) && num(c.rhHigh) && c.rhLow >= 50 && c.rhHigh <= 100 && c.rhLow < c.rhHigh &&
    Array.isArray(p.compatible_in_same_room);
  if (!ok) throw new Error(`Invalid crop profile: ${source}`);
  return p as CropProfile;
}

@Injectable()
export class CropsService {
  private cache = new Map<string, CropProfile>();

  constructor(private db: Database) {}

  /**
   * Loads crop-profiles/*.json into the database, at every start. A profile edited in the admin
   * portal (higher version) is not overwritten by an older file.
   */
  async syncFromFiles(dir: string, db: Queryable = this.db.pool): Promise<string[]> {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
    const crops: string[] = [];
    for (const file of files) {
      const profile = validateProfile(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), file);
      await this.db.query(
        `INSERT INTO crop_profiles (crop, version, data) VALUES ($1, $2, $3)
         ON CONFLICT (crop) DO UPDATE SET version = EXCLUDED.version, data = EXCLUDED.data, updated_at = now()
         WHERE crop_profiles.version <= EXCLUDED.version AND crop_profiles.data IS DISTINCT FROM EXCLUDED.data`,
        [profile.crop, profile.version, profile],
        db
      );
      crops.push(profile.crop);
    }
    this.cache = new Map();
    return crops;
  }

  async get(crop: string): Promise<CropProfile> {
    const hit = this.cache.get(crop);
    if (hit) return hit;
    const row = await this.db.one<{ data: CropProfile }>('SELECT data FROM crop_profiles WHERE crop = $1', [crop]);
    if (!row) throw new Error(`No crop profile for ${crop}`);
    this.cache.set(crop, row.data);
    return row.data;
  }

  clearCache() {
    this.cache = new Map();
  }

  /** A crop may go into a room if it is the room's crop or listed as compatible with it. */
  canShareRoom(roomProfile: CropProfile, crop: string): boolean {
    return crop === roomProfile.crop || roomProfile.compatible_in_same_room.includes(crop);
  }
}
