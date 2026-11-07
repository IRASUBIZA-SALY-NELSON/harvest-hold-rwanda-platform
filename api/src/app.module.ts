import { Controller, Get, Global, Module, Res } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { FastifyReply } from 'fastify';

import { ApiErrorFilter } from './common/api-error.filter.js';
import { Database, DatabaseModule } from './common/database.service.js';
import { DeviceGuard, UserGuard } from './common/guards.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AlertsController } from './modules/alerts/alerts.controller.js';
import { AuditModule } from './modules/audit/audit.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { UserAuthService } from './modules/auth/user-auth.service.js';
import { CertificatesService } from './modules/certificates/certificates.service.js';
import { SigningService } from './modules/certificates/signing.service.js';
import { CropsService } from './modules/crops/crops.service.js';
import { CommandsService } from './modules/commands/commands.service.js';
import { DevicesController } from './modules/devices/devices.controller.js';
import { IngestService } from './modules/devices/ingest.service.js';
import { EnergyService } from './modules/energy/energy.service.js';
import { MqttService } from './modules/mqtt/mqtt.service.js';
import { RecommendationsService } from './modules/recommendations/recommendations.service.js';
import { StorageService } from './modules/storage/storage.service.js';
import { EventsModule } from './modules/events/events.service.js';
import { MarketController } from './modules/market/market.controller.js';
import { MediaController } from './modules/media/media.controller.js';
import { MediaService } from './modules/media/media.service.js';
import { MonitorService } from './modules/monitor/monitor.service.js';
import { NotifyModule } from './modules/notify/notify.service.js';
import { RoomsController } from './modules/rooms/rooms.controller.js';
import { RoomsService } from './modules/rooms/rooms.service.js';
import { StockController } from './modules/stock/stock.controller.js';
import { StorageRequestsController } from './modules/stock/storage-requests.controller.js';
import { VerifyController } from './modules/verify/verify.controller.js';

@Controller()
class HealthController {
  constructor(private db: Database) {}

  /** 503 when the database is down (for the load balancer and monitoring). */
  @Get('health')
  async health(@Res({ passthrough: true }) reply: FastifyReply) {
    try {
      await this.db.query('SELECT 1');
      return { ok: true };
    } catch {
      reply.code(503);
      return { ok: false };
    }
  }
}

/** Shared services used by the mobile API, the controllers' API and the admin API. */
const CORE_PROVIDERS = [CommandsService, IngestService, MqttService, EnergyService, RecommendationsService, StorageService, CropsService, RoomsService, CertificatesService, SigningService, MediaService, MonitorService, UserAuthService, UserGuard, DeviceGuard];

@Global()
@Module({ providers: CORE_PROVIDERS, exports: CORE_PROVIDERS })
class CoreModule {}

@Module({
  imports: [DatabaseModule, EventsModule, NotifyModule, AuditModule, CoreModule, AdminModule],
  controllers: [HealthController, AuthController, RoomsController, StockController, StorageRequestsController, MarketController, AlertsController, DevicesController, VerifyController, MediaController],
  providers: [{ provide: APP_FILTER, useClass: ApiErrorFilter }],
})
export class AppModule {}
