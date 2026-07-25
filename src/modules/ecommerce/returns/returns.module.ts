/**
 * ReturnsModule — Returns / RMA lifecycle (Phase 3, P3-02).
 *
 * Wiring notes:
 *   - PaymentModule (exports RefundService) is imported directly — the returns
 *     money flow REUSES the guarded refund; there is no cycle (Payment never
 *     imports Returns).
 *   - CourierModule is imported via forwardRef: Returns calls
 *     CourierService.createReturnShipment, and CourierService calls back into
 *     ReturnsService for the reverse-webhook edge — forwardRef on both sides.
 *   - TcsService / NotificationService / AuditService / OutboxService are all
 *     @Global, so no import is needed (taken as optional trailing params).
 *   - ReturnsService is exported so OutboxModule's EmailsProcessor and
 *     CourierModule can resolve it.
 */

import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';
import { EmailModule } from '@/modules/admin/email/email.module';
import { PaymentModule } from '@/modules/ecommerce/payment/payment.module';
import { CourierModule } from '@/modules/ecommerce/courier/courier.module';
import { ReturnsService } from './returns.service';
import { ReturnsResolver } from './returns.resolver';
import { ReturnsAdminResolver } from './returns-admin.resolver';
import { ReturnsReconciliationCron } from './returns-reconciliation.cron';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    // forwardRef: Returns -> Payment closes the module ring
    // Order -> Courier -> Returns -> Payment -> Order (Payment imports Order).
    // Deferring this edge lets Nest break the cycle (Courier<->Returns already
    // forwardRef both ways). RefundService still injects normally at runtime.
    forwardRef(() => PaymentModule),
    forwardRef(() => CourierModule),
  ],
  providers: [
    ReturnsService,
    ReturnsResolver,
    ReturnsAdminResolver,
    ReturnsReconciliationCron,
  ],
  exports: [ReturnsService],
})
export class ReturnsModule {}
