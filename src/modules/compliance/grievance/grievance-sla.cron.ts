/**
 * GrievanceSlaCron — flags/escalates grievances past their SLA deadline (P4-01).
 *
 * CP-EC Rules 2020 require redressal within a "reasonable time". Each ticket
 * carries an `slaDueAt` derived from its priority (GRIEVANCE_SLA_HOURS —
 * // NEEDS LEGAL SIGN-OFF). This cron runs daily and moves any still-open ticket
 * whose deadline has passed to ESCALATED (guarded per-ticket so a concurrent
 * officer action / a re-run never double-escalates). Modeled on
 * PaymentReconciliationCron — same in-process `running` guard so a slow run never
 * overlaps itself.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GrievanceService } from './grievance.service';

@Injectable()
export class GrievanceSlaCron {
  private readonly logger = new Logger(GrievanceSlaCron.name);
  private running = false;

  constructor(private readonly grievance: GrievanceService) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async escalateOverdue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const escalated = await this.grievance.runSlaEscalation();
      if (escalated > 0) {
        this.logger.log(
          `Grievance SLA sweep: escalated ${escalated} overdue complaint(s).`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Grievance SLA sweep failed: ${(err as Error).message}`,
      );
    } finally {
      this.running = false;
    }
  }
}
