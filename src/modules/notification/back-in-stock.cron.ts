/**
 * BackInStockCron — periodically sweeps wishlists for restocked items and
 * enqueues durable back-in-stock alerts (Phase 4, notification depth).
 *
 * Modeled on PaymentReconciliationCron: an in-process `running` guard so a slow
 * sweep never overlaps itself, and every fault is caught + logged (the cron must
 * never crash the scheduler). The durable work (dedupe ledger + outbox enqueue)
 * lives in BackInStockService.runSweep; this is just the scheduled trigger.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BackInStockService } from './back-in-stock.service';

@Injectable()
export class BackInStockCron {
  private readonly logger = new Logger(BackInStockCron.name);
  private running = false;

  constructor(private readonly backInStock: BackInStockService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { alerted, rearmed } = await this.backInStock.runSweep();
      if (alerted || rearmed) {
        this.logger.log(
          `Back-in-stock sweep: ${alerted} alert(s) enqueued, ${rearmed} re-armed.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Back-in-stock sweep failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
