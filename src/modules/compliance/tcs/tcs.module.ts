/**
 * TcsModule — marketplace §52 TCS accrual/ledger/export (Phase 3, P3-03).
 *
 * `@Global` (like AuditModule / OutboxCoreModule) so the money-mover services in
 * OTHER modules — PaymentService (accrue at capture), RefundService (reverse on
 * refund), PayoutService (net TCS out of the payout) — can inject TcsService
 * WITHOUT their modules importing this one. They take it as an OPTIONAL trailing
 * constructor param, so their existing positional unit tests keep compiling; the
 * running app always resolves it because this module is registered once in
 * AppModule (CENTRAL-WIRING TODO).
 *
 * Dependencies are all @Global (PrismaService, OutboxService) or @Global config
 * (ConfigService), so no `imports` are needed.
 *
 * TcsService is exported so the central outbox EmailsProcessor can inject it to
 * run the `email.tcs_deposit_reminder` handler (see WIRE-OUTBOX note in the
 * service + CENTRAL-WIRING TODO).
 */

import { Global, Module } from '@nestjs/common';
import { TcsService } from './tcs.service';
import { TcsResolver } from './tcs.resolver';
import { TcsDepositReminderCron } from './tcs-deposit-reminder.cron';

@Global()
@Module({
  providers: [TcsService, TcsResolver, TcsDepositReminderCron],
  exports: [TcsService],
})
export class TcsModule {}
