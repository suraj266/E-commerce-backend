/**
 * PayoutModule — seller settlement ledger (Phase 2, P2-02).
 *
 * Imports EmailModule so a disbursed payout can fire `seller_payout_disbursed`.
 * PrismaService comes from the global PrismaModule.
 */

import { Module } from '@nestjs/common';
import { EmailModule } from '@/modules/admin/email/email.module';
import { PayoutService } from './payout.service';
import { PayoutAdminResolver } from './payout-admin.resolver';

@Module({
  imports: [EmailModule],
  providers: [PayoutService, PayoutAdminResolver],
  exports: [PayoutService],
})
export class PayoutModule {}
