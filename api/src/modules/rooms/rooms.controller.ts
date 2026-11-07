import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { notAllowed } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { CurrentUser, type SessionUser, UserGuard } from '../../common/guards.js';
import { RoomsService } from './rooms.service.js';

const DAY = 86_400_000;

@Controller('cold-rooms')
export class RoomsController {
  constructor(
    private db: Database,
    private rooms: RoomsService
  ) {}

  /** Public: the sign-up screen lists cold rooms (retired ones are hidden). */
  @Get()
  async list() {
    const rooms = await this.db.query("SELECT * FROM cold_rooms WHERE status <> 'retired' ORDER BY name");
    return Promise.all(rooms.map((r) => this.rooms.view(r)));
  }

  @Get(':id')
  @UseGuards(UserGuard)
  async get(@Param('id') id: string) {
    return this.rooms.view(await this.rooms.getRow(id));
  }

  /** Live status: only for farmers who use this room. */
  @Get(':id/status')
  @UseGuards(UserGuard)
  async status(@Param('id') id: string, @CurrentUser() u: SessionUser) {
    if (u.cold_room_id !== id) throw notAllowed();
    const room = await this.rooms.getRow(id);
    const crates = await this.db.one<{ n: number }>(
      // kg are counted as 20 kg crates.
      "SELECT coalesce(sum(CASE WHEN unit = 'crate' THEN quantity ELSE ceil(quantity / 20.0) END), 0)::int AS n FROM batches WHERE cold_room_id = $1 AND status = 'stored'",
      [room.id]
    );
    return {
      room: await this.rooms.view(room),
      reading: await this.rooms.latestReading(room.id),
      last24h: await this.rooms.summarize(room, Date.now() - DAY),
      storedCrates: crates!.n,
      /** Wh used by the cooler since midnight (Peltier rooms with a power meter), else null. */
      energyTodayWh: room.cooling_type === 'peltier' ? await this.rooms.energyToday(room.id) : null,
    };
  }

  @Get(':id/history')
  @UseGuards(UserGuard)
  async history(@Param('id') id: string, @Query('range') range: string, @CurrentUser() u: SessionUser) {
    if (u.cold_room_id !== id) throw notAllowed();
    await this.rooms.getRow(id);
    return this.rooms.history(id, range === '7d' ? '7d' : '24h');
  }
}
