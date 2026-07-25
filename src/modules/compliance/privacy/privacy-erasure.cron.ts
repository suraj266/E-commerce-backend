/**
 * PrivacyErasureCron — executes due erasure requests + export housekeeping.
 *
 * Runs the IRREVERSIBLE anonymization scrub for any AccountDeletionRequest
 * whose grace window has elapsed, and sweeps stale/expired export requests.
 * Modeled on PaymentReconciliationCron (same in-process `running` guard).
 *
 * Per-request isolation: each anonymization runs in its own try/catch so one
 * bad row can't stop the batch. `anonymizeUser` is idempotent, so a row that
 * partially failed is safely retried on the next tick.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PrivacyService } from './privacy.service';

@Injectable()
export class PrivacyErasureCron {
  private readonly logger = new Logger(PrivacyErasureCron.name);
  private running = false;

  constructor(private readonly privacy: PrivacyService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.privacy.findDueDeletions();
      let anonymized = 0;
      for (const request of due) {
        try {
          const result = await this.privacy.anonymizeUser(request.userId);
          if (result.scrubbed) anonymized++;
        } catch (err) {
          // Isolate the failure — the row stays GRACE and is retried next tick.
          this.logger.error(
            `Anonymization failed for deletion request ${request.id} (user ${request.userId}): ${(err as Error).message}`,
          );
          Sentry.captureException(err, (scope) => {
            scope.setTag('privacy.deletion_request_id', request.id);
            return scope;
          });
        }
      }

      const swept = await this.privacy.sweepExports();

      if (anonymized || swept.expired || swept.failed) {
        this.logger.log(
          `Privacy cron: anonymized ${anonymized}/${due.length} due request(s); ` +
            `exports expired ${swept.expired}, failed ${swept.failed}.`,
        );
      }
    } catch (err) {
      this.logger.error(`Privacy erasure cron run failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
