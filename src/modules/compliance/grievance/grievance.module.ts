/**
 * GrievanceModule — CP-EC complaint-redressal workflow (Phase 4, P4-01).
 *
 * Wiring notes:
 *   - PrismaModule + EmailModule are imported directly (EmailModule is not
 *     @Global; the customer comms go through EmailService).
 *   - OutboxService (OutboxCoreModule), NotificationService, AuditService and
 *     ConfigService are all @Global, so no import is needed — the last two are
 *     taken as OPTIONAL trailing constructor params.
 *   - GrievanceService is EXPORTED so the central outbox EmailsProcessor can
 *     inject it to run the `email.grievance_*` handlers. That requires OutboxModule
 *     to import GrievanceModule (CENTRAL-WIRING TODO — see the report); this edge
 *     stays one-way because GrievanceModule never imports OutboxModule.
 *
 * Registered once in AppModule (this workstream is the sole app.module editor).
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmailModule } from '@/modules/admin/email/email.module';
import { GrievanceService } from './grievance.service';
import { GrievanceResolver } from './grievance.resolver';
import { GrievanceAdminResolver } from './grievance-admin.resolver';
import { GrievanceSlaCron } from './grievance-sla.cron';

@Module({
  imports: [PrismaModule, EmailModule],
  providers: [
    GrievanceService,
    GrievanceResolver,
    GrievanceAdminResolver,
    GrievanceSlaCron,
  ],
  exports: [GrievanceService],
})
export class GrievanceModule {}
