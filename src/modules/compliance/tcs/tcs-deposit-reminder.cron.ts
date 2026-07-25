/**
 * TcsDepositReminderCron — nudges finance to file GSTR-8 + deposit the TCS
 * challan by the 10th of the month following each supply month (P3-03).
 *
 * Runs daily; `runDepositReminder` only acts inside the by-10th window and
 * enqueues at most one (deduped-by-period) reminder per period, so the daily
 * cadence never spams. Modeled on PaymentReconciliationCron — same in-process
 * `running` guard so a slow run never overlaps itself.
 *
 * This is the `@nestjs/schedule` fallback path: even if the outbox reminder
 * email is not yet wired, the cron still refreshes the deposit roll-up and logs
 * the outstanding obligation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TcsService } from './tcs.service';

@Injectable()
export class TcsDepositReminderCron {
  private readonly logger = new Logger(TcsDepositReminderCron.name);
  private running = false;

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async remind(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const period = await this.tcs.runDepositReminder();
      if (period) {
        this.logger.log(`TCS deposit reminder emitted for period ${period}.`);
      }
    } catch (err) {
      this.logger.error(
        `TCS deposit reminder run failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }

  constructor(private readonly tcs: TcsService) {}
}
