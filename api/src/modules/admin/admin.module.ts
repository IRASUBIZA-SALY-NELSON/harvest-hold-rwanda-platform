import { Module } from '@nestjs/common';

import { AdminAuthController } from './admin-auth.controller.js';
import { AdminMarketController } from './admin-market.controller.js';
import { AdminOpsController } from './admin-ops.controller.js';
import { AdminOverviewController } from './admin-overview.controller.js';
import { AdminRoomsController } from './admin-rooms.controller.js';
import { AdminStaffController } from './admin-staff.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminFieldController } from './admin-field.controller.js';
import { AdminGuard } from './admin.guard.js';
import { InsightsService } from './insights.service.js';

/** Everything under /admin: used by the admin portal (admin/), never by the mobile app. */
@Module({
  controllers: [AdminAuthController, AdminOverviewController, AdminRoomsController, AdminUsersController, AdminMarketController, AdminOpsController, AdminStaffController, AdminFieldController],
  providers: [AdminGuard, InsightsService],
})
export class AdminModule {}
