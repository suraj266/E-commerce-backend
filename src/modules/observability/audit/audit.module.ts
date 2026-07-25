/**
 * AuditModule — the append-only security audit trail (P3-05).
 *
 * `@Global` (like OutboxCoreModule / PrismaModule) so the money-mover services
 * scattered across payment/payout modules can inject `AuditService` WITHOUT
 * every one of their modules having to add an import — auditing is a
 * cross-cutting concern. Registered once in AppModule.
 *
 * Also provides the read resolver (permission-gated `auditLogs` query). The
 * global AuditInterceptor is bound in AppModule as an APP_INTERCEPTOR (a global
 * provider can't be exported from a feature module), reusing this module's
 * exported AuditService.
 */

import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditResolver } from './audit.resolver';

@Global()
@Module({
  providers: [AuditService, AuditResolver],
  exports: [AuditService],
})
export class AuditModule {}
