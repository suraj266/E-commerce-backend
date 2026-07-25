/**
 * Backstop for returns stuck in QC_PASSED — a crash after the QC flip but before
 * the refund/clawback/TCS fan-out committed leaves the return QC_PASSED with the
 * buyer un-refunded. The idempotent completion is re-driven here so money is
 * never lost. Modeled on PaymentReconciliationCron (in-process `running` guard).
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReturnsService } from './returns.service';

@Injectable()
export class ReturnsReconciliationCron {
  private readonly logger = new Logger(ReturnsReconciliationCron.name);
  private running = false;

  constructor(private readonly returns: ReturnsService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const resumed = await this.returns.reconcileStuckReturns();
      if (resumed > 0) {
        this.logger.log(`Returns reconciliation: resumed ${resumed} QC_PASSED return(s).`);
      }
    } catch (err) {
      this.logger.error(
        `Returns reconciliation run failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
