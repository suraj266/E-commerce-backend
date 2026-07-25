/**
 * PrivacyService — DPDP Act 2023 data-subject rights (P3-07).
 *
 * Implements three principal rights:
 *   - Data portability : requestExport → outbox job → signed expiring URL email.
 *   - Erasure          : requestDeletion / cancelDeletion → grace window → the
 *                        irreversible `anonymizeUser` scrub (run by the cron).
 *   - Consent          : recordConsent (append-only) + canMarket (fail-closed).
 *
 * ⚠️ ERASURE IS IRREVERSIBLE. `anonymizeUser` scrubs PII to tombstones and can
 * never be undone. It is written to be IDEMPOTENT (safe to re-run) and ships
 * with a DRY-RUN mode (logs the plan, writes nothing) for staging rehearsal —
 * see `anonymizeUser`.
 *
 * Retention carve-out: we KEEP every Order / Payment / Invoice / TcsLedger row
 * and every generated invoice PDF (7-year GST mandate). Only identity PII
 * (User + UserAddress) and marketing linkage are scrubbed. The immutable
 * invoice PDF carries the legally-required buyer snapshot.
 * 👤 NEEDS LEGAL SIGN-OFF on the exact carve-out list and that
 *    anonymization-not-deletion satisfies the erasure right.
 */

import {
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountDeletionStatus,
  ConsentPurpose,
  DataExportStatus,
  NewsletterStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { OUTBOX_QUEUE } from '@/modules/outbox/outbox.constants';
import { UserService } from '@/modules/identity/user/user.service';
import { AuthService } from '@/modules/identity/auth/auth.service';
import { AuditService } from '@/modules/observability/audit/audit.service';
import { PrivacyExportStorageService } from './privacy-export-storage.service';
import {
  ANONYMIZED_EMAIL_DOMAIN,
  CONSENT_SOURCE_PRIVACY_PAGE,
  DELETION_GRACE_DAYS,
  EXPORT_READY_EMAIL_TEMPLATE,
  EXPORT_URL_TTL_HOURS,
  PRIVACY_OUTBOX_EVENT,
} from './privacy.constants';

/** How long a PENDING/PROCESSING export may sit before we give up on it. */
const STALE_EXPORT_HOURS = 24;

/** What a dry-run anonymization WOULD do (nothing is written). */
export interface AnonymizationPlan {
  userId: string;
  emailFrom: string;
  emailTo: string;
  addressesToScrub: number;
  dryRun: boolean;
  scrubbed: boolean;
  reason?: string;
}

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly email: EmailService,
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly exportStorage: PrivacyExportStorageService,
    private readonly config: ConfigService,
    // @Global AuditService (P3-05). Optional so the unit spec's positional
    // construction stays valid; Nest always injects it in the running app.
    private readonly audit?: AuditService,
  ) {}

  // ===========================================================================
  // Data export (portability)
  // ===========================================================================

  /**
   * Create a data-export request and durably enqueue the build job. The
   * OutboxEvent is written INSIDE the same transaction as the request row, so
   * "we owe an export" commits atomically with the request (canonical outbox).
   */
  async requestExport(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.dataExportRequest.create({
        data: { userId, status: DataExportStatus.PENDING },
      });

      // WIRE-OUTBOX: type=privacy.data_export queue=emails handler=PrivacyService.buildAndSendDataExport payload={ exportRequestId }
      await this.outbox.enqueue(tx, {
        type: PRIVACY_OUTBOX_EVENT.DATA_EXPORT,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { exportRequestId: request.id },
        dedupeKey: `privacy:data_export:${request.id}`,
      });

      return request;
    });
  }

  /**
   * Authorize a data-export download for the LOCAL storage provider. Fail-closed
   * gate used by PrivacyExportDownloadController before it streams the bundle:
   *   - ownership: the request must belong to the calling principal (a mismatch
   *     404s so we never reveal that another user's export id exists);
   *   - readiness: only a READY export is downloadable;
   *   - expiry:    past `expiresAt` the link is Gone (mirrors the presigned-URL
   *     TTL the S3 path enforces cryptographically).
   * Returns the request (its `userId`/`id` locate the on-disk bundle).
   */
  async authorizeExportDownload(userId: string, exportRequestId: string) {
    const request = await this.prisma.dataExportRequest.findUnique({
      where: { id: exportRequestId },
    });
    if (!request || request.userId !== userId) {
      throw new NotFoundException('Export not found.');
    }
    if (request.status !== DataExportStatus.READY) {
      throw new NotFoundException('Export is not available for download.');
    }
    if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('This export download link has expired.');
    }
    return request;
  }

  /** The principal's own export requests (most recent first). */
  async myExports(userId: string) {
    return this.prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Outbox handler for `privacy.data_export`. Re-reads the request by id,
   * assembles the principal's data bundle, stores it, emails a signed expiring
   * URL, then marks the request READY.
   *
   * Idempotent + retry-safe:
   *   - An already-READY request is a no-op (duplicate delivery).
   *   - We finalize to READY only AFTER the email is handled, so a failed send
   *     leaves the request PROCESSING and re-running the job re-stores (same
   *     key, fresh signed URL) and re-sends. Throws on a hard failure so the
   *     outbox retries; returns cleanly when there is no recipient.
   */
  async buildAndSendDataExport(exportRequestId: string): Promise<void> {
    const request = await this.prisma.dataExportRequest.findUnique({
      where: { id: exportRequestId },
    });
    if (!request) return; // nothing to do
    if (request.status === DataExportStatus.READY) return; // idempotent replay

    await this.prisma.dataExportRequest.update({
      where: { id: request.id },
      data: { status: DataExportStatus.PROCESSING },
    });

    const bundle = await this.assembleExportBundle(request.userId);
    const json = JSON.stringify(bundle, null, 2);

    // Throws on storage failure → the outbox retries the whole job.
    const stored = await this.exportStorage.putBundle(
      request.userId,
      request.id,
      json,
    );

    // Email the link BEFORE finalizing to READY. A tombstoned (already
    // anonymized) address gets no email — the bundle is still recorded.
    const user = await this.prisma.user.findUnique({
      where: { id: request.userId },
      select: { email: true, name: true },
    });
    if (user && !user.email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`)) {
      const result = await this.email.send(
        EXPORT_READY_EMAIL_TEMPLATE,
        user.email,
        {
          customerName: user.name ?? 'there',
          downloadLink: stored.fileUrl,
          expiresInHours: EXPORT_URL_TTL_HOURS,
          expiresAt: stored.expiresAt.toISOString(),
        },
      );
      // Skipped (SMTP off / template disabled) is acceptable — the link is
      // still stored and visible in the account UI. A genuine send failure
      // must retry.
      if (!result.sent && !result.skipped) {
        throw new Error(`data_export_ready email failed: ${result.message}`);
      }
    }

    await this.prisma.dataExportRequest.update({
      where: { id: request.id },
      data: {
        status: DataExportStatus.READY,
        fileUrl: stored.fileUrl,
        expiresAt: stored.expiresAt,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Assemble the principal's personal data into a portable JSON bundle. Each
   * section is best-effort so a missing relation never aborts the export.
   */
  private async assembleExportBundle(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { addresses: true, Customer: true },
    });

    const customerId = user?.Customer?.id ?? null;

    const orders = customerId
      ? await this.prisma.order.findMany({
          where: { customerId },
          orderBy: { placedAt: 'desc' },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            totalAmount: true,
            currencyCode: true,
            placedAt: true,
          },
        })
      : [];

    const consentHistory = await this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const newsletter = user?.email
      ? await this.prisma.newsletterSubscription.findUnique({
          where: { email: user.email },
        })
      : null;

    return {
      generatedAt: new Date().toISOString(),
      notice:
        'This export contains a copy of the personal data we hold about you. ' +
        'Order, invoice and tax records are retained for statutory compliance ' +
        'even after account deletion.',
      profile: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            gender: user.gender,
            dateOfBirth: user.dateOfBirth,
            createdAt: user.createdAt,
            preferredCurrency: user.Customer?.preferredCurrency ?? null,
          }
        : null,
      addresses:
        user?.addresses.map((a) => ({
          type: a.type,
          label: a.label,
          firstName: a.firstName,
          lastName: a.lastName,
          phone: a.phone,
          addressLine1: a.addressLine1,
          addressLine2: a.addressLine2,
          city: a.city,
          state: a.state,
          postalCode: a.postalCode,
          countryCode: a.countryCode,
        })) ?? [],
      orders,
      consentHistory,
      newsletter: newsletter
        ? { status: newsletter.status, subscribedAt: newsletter.createdAt }
        : null,
    };
  }

  /**
   * Housekeeping for export requests (called by the cron):
   *   - READY requests past `expiresAt` → EXPIRED (the signed URL has lapsed).
   *   - PENDING/PROCESSING requests older than STALE_EXPORT_HOURS → FAILED
   *     (the outbox job exhausted its retries and parked; surface that to the
   *     principal so they can request a fresh export).
   */
  async sweepExports(): Promise<{ expired: number; failed: number }> {
    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - STALE_EXPORT_HOURS * 3600 * 1000,
    );

    const [expired, failed] = await this.prisma.$transaction([
      this.prisma.dataExportRequest.updateMany({
        where: { status: DataExportStatus.READY, expiresAt: { lte: now } },
        data: { status: DataExportStatus.EXPIRED, fileUrl: null },
      }),
      this.prisma.dataExportRequest.updateMany({
        where: {
          status: {
            in: [DataExportStatus.PENDING, DataExportStatus.PROCESSING],
          },
          createdAt: { lt: staleBefore },
        },
        data: { status: DataExportStatus.FAILED },
      }),
    ]);
    return { expired: expired.count, failed: failed.count };
  }

  // ===========================================================================
  // Account deletion (erasure)
  // ===========================================================================

  /**
   * Open an erasure request. We start the cooling-off clock immediately
   * (status GRACE, executeAfter = now + DELETION_GRACE_DAYS). Idempotent: an
   * existing active GRACE request is returned rather than duplicated.
   */
  async requestDeletion(userId: string) {
    const existing = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: AccountDeletionStatus.GRACE },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;

    const executeAfter = new Date(
      Date.now() + DELETION_GRACE_DAYS * 24 * 3600 * 1000,
    );
    const request = await this.prisma.accountDeletionRequest.create({
      data: {
        userId,
        status: AccountDeletionStatus.GRACE,
        executeAfter,
      },
    });
    await this.audit?.record({
      action: 'account.deletion_requested',
      entityType: 'User',
      entityId: userId,
      actorUserId: userId,
      after: { requestId: request.id, executeAfter },
    });
    this.logger.log(
      `Erasure requested for user ${userId}; grace until ${executeAfter.toISOString()}.`,
    );
    return request;
  }

  /**
   * Cancel a still-in-grace erasure request. Only a GRACE request can be
   * cancelled (ANONYMIZED is terminal + irreversible). Idempotent-ish: returns
   * the latest request either way.
   */
  async cancelDeletion(userId: string) {
    const active = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: AccountDeletionStatus.GRACE },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) {
      // Nothing to cancel — return the most recent request (or null) so the UI
      // reflects reality without erroring.
      return this.prisma.accountDeletionRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    }
    // CONDITIONAL cancel: only flip while still GRACE. This races the erasure
    // cron's atomic claim (which flips GRACE->ANONYMIZED in one statement) on the
    // same row; row locking serializes them so exactly one wins. If the claim
    // already anonymized the account, this matches 0 rows and we refuse to
    // clobber the terminal ANONYMIZED state — an executed erasure cannot be
    // "cancelled" after the fact.
    const res = await this.prisma.accountDeletionRequest.updateMany({
      where: { id: active.id, status: AccountDeletionStatus.GRACE },
      data: {
        status: AccountDeletionStatus.CANCELLED,
        cancelledAt: new Date(),
      },
    });
    const latest = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: active.id },
    });
    if (res.count === 0) {
      // Lost the race — the erasure already executed. Do not audit a cancel.
      this.logger.warn(
        `Erasure request ${active.id} could not be cancelled — already ${latest?.status}.`,
      );
      return latest;
    }
    await this.audit?.record({
      action: 'account.deletion_cancelled',
      entityType: 'User',
      entityId: userId,
      actorUserId: userId,
      before: { requestId: active.id, status: active.status },
      after: { status: latest?.status },
    });
    this.logger.log(`Erasure request ${active.id} cancelled by user ${userId}.`);
    return latest;
  }

  /** The principal's most recent deletion request (or null). */
  async myDeletion(userId: string) {
    return this.prisma.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** GRACE requests whose cooling-off window has elapsed — the cron claim set. */
  async findDueDeletions() {
    return this.prisma.accountDeletionRequest.findMany({
      where: {
        status: AccountDeletionStatus.GRACE,
        executeAfter: { lte: new Date() },
      },
      orderBy: { executeAfter: 'asc' },
    });
  }

  /**
   * IRREVERSIBLE erasure scrub for a single principal. Orchestration only — the
   * actual PII writes live in the identity module (UserService.anonymizePii,
   * AuthService.revokeAllSessions) so this module never touches identity tables
   * directly.
   *
   * Steps (each individually idempotent):
   *   1. Scrub User + UserAddress PII to tombstones + sever login (UserService).
   *   2. Revoke all sessions + refresh tokens (AuthService).
   *   3. Unsubscribe the ORIGINAL email from the newsletter.
   *   4. Stamp the deletion request(s) ANONYMIZED.
   * We KEEP all Order/Payment/Invoice/TcsLedger rows + invoice PDFs.
   *
   * DRY-RUN: when enabled (staging), we compute + LOG the plan and write
   * NOTHING. Enable via env `PRIVACY_ANONYMIZATION_DRY_RUN=true` or pass
   * `{ dryRun: true }`.
   */
  async anonymizeUser(
    userId: string,
    opts: { dryRun?: boolean } = {},
  ): Promise<AnonymizationPlan> {
    const dryRun = opts.dryRun ?? this.isDryRunEnabled();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { addresses: { select: { id: true } } },
    });
    if (!user) {
      this.logger.warn(`anonymizeUser: user ${userId} not found — skipping.`);
      return {
        userId,
        emailFrom: '',
        emailTo: '',
        addressesToScrub: 0,
        dryRun,
        scrubbed: false,
        reason: 'user-not-found',
      };
    }

    const originalEmail = user.email;
    const alreadyAnonymized =
      user.status === 'anonymized' ||
      originalEmail.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`);

    const plan: AnonymizationPlan = {
      userId,
      emailFrom: originalEmail,
      emailTo: `deleted+${userId}@${ANONYMIZED_EMAIL_DOMAIN}`,
      addressesToScrub: user.addresses.length,
      dryRun,
      scrubbed: false,
    };

    if (dryRun) {
      this.logger.warn(
        `[DRY-RUN] Would anonymize user ${userId}: ${JSON.stringify(plan)} ` +
          `(Order/Payment/Invoice/TcsLedger rows + PDFs would be KEPT).`,
      );
      return { ...plan, reason: alreadyAnonymized ? 'already-anonymized' : undefined };
    }

    // The irreversible scrub is performed atomically with an authorization CLAIM
    // and the final ANONYMIZED stamp, all in ONE interactive transaction:
    //   1. Atomically claim the request out of GRACE (conditional updateMany).
    //      This is the authorization gate — if a concurrent cancelDeletion()
    //      already flipped the row to CANCELLED, this matches 0 rows and we do
    //      NOT scrub (a cancelled erasure is never executed).
    //   2. Only when the claim succeeds: unsubscribe newsletter (using the still
    //      -live original email), scrub PII, revoke sessions — all on `tx`.
    // Because claim + scrub share one tx, a mid-scrub failure rolls the claim
    // back too: the request returns to GRACE and is retried next tick, and a
    // cancel can still win. No partial state (fixes both the cancel race and the
    // crash-between-steps newsletter leak).
    const now = new Date();
    let didScrub = false;
    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.accountDeletionRequest.updateMany({
          where: { userId, status: AccountDeletionStatus.GRACE },
          data: {
            status: AccountDeletionStatus.ANONYMIZED,
            anonymizedAt: now,
          },
        });
        // No live in-grace request: cancelled, already-anonymized, or never
        // requested. Never scrub without winning the GRACE claim.
        if (claimed.count === 0) return;

        await this.unsubscribeNewsletter(originalEmail, tx);
        await this.userService.anonymizePii(userId, tx);
        await this.authService.revokeAllSessions(userId, tx);
        didScrub = true;
      },
      { timeout: 20000 },
    );

    if (didScrub) {
      // System actor (cron/erasure), not a principal — actorUserId null.
      await this.audit?.record({
        action: 'account.anonymized',
        entityType: 'User',
        entityId: userId,
        actorUserId: null,
      });
      this.logger.log(`Anonymized user ${userId} (DPDP erasure).`);
    } else {
      this.logger.log(
        `anonymizeUser: no live GRACE erasure claim for user ${userId} ` +
          `(${alreadyAnonymized ? 'already-anonymized' : 'cancelled/none'}) — skipped.`,
      );
    }
    return {
      ...plan,
      scrubbed: didScrub,
      reason: didScrub
        ? undefined
        : alreadyAnonymized
          ? 'already-anonymized'
          : 'no-active-request',
    };
  }

  private async unsubscribeNewsletter(
    email: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;
    const sub = await db.newsletterSubscription.findUnique({
      where: { email },
    });
    if (!sub || sub.status === NewsletterStatus.UNSUBSCRIBED) return;
    await db.newsletterSubscription.update({
      where: { email },
      data: {
        status: NewsletterStatus.UNSUBSCRIBED,
        unsubscribedAt: new Date(),
      },
    });
  }

  private isDryRunEnabled(): boolean {
    return (
      this.config.get<string>('PRIVACY_ANONYMIZATION_DRY_RUN', 'false') ===
      'true'
    );
  }

  // ===========================================================================
  // Consent
  // ===========================================================================

  /**
   * Append an immutable consent decision. There is NO update path — a change of
   * mind is a new row (the DB trigger rejects UPDATE/DELETE on ConsentRecord).
   */
  async recordConsent(
    userId: string,
    purpose: ConsentPurpose,
    granted: boolean,
    source: string,
    tx?: Prisma.TransactionClient,
  ) {
    // PrismaClient is assignable to TransactionClient, so this unifies the
    // in-tx and standalone callsites under one concrete type.
    const client: Prisma.TransactionClient = tx ?? this.prisma;
    return client.consentRecord.create({
      data: { userId, purpose, granted, source },
    });
  }

  /**
   * Marketing gate — FAIL CLOSED. Returns the LATEST consent state for
   * MARKETING_EMAIL; when there is NO record at all, returns false (we may not
   * market to someone who never made a decision).
   *
   * // CONSENT GATE (P3-08/newsletter) — WIRED: the live caller is
   * // NewsletterService.filterMarketableRecipients(), which resolves each
   * // recipient email to a User and drops anyone this method returns false for
   * // (fail-closed). Any marketing/newsletter SEND path MUST pass its recipients
   * // through that gate before dispatch. NOTE: no BULK marketing-broadcast send
   * // loop exists yet, so the gate has no production callsite loop today; the
   * // double-opt-in CONFIRMATION email is transactional (it captures consent)
   * // and is intentionally NOT gated. When a broadcast feature lands, it MUST
   * // call filterMarketableRecipients() — do not add an ungated send path.
   *
   * // NEEDS LEGAL SIGN-OFF: whether a legacy `Customer.marketingOptIn=true`
   * // (set before this consent ledger existed) counts as valid consent, or
   * // whether existing customers must actively re-consent. Until signed off,
   * // this gate ignores the legacy flag and requires an explicit ConsentRecord.
   */
  async canMarket(userId: string): Promise<boolean> {
    const latest = await this.prisma.consentRecord.findFirst({
      where: { userId, purpose: ConsentPurpose.MARKETING_EMAIL },
      orderBy: { createdAt: 'desc' },
    });
    return latest?.granted ?? false;
  }

  /** Toggle marketing consent from the account privacy page. */
  async updateMarketingConsent(
    userId: string,
    granted: boolean,
  ): Promise<{ granted: boolean }> {
    await this.recordConsent(
      userId,
      ConsentPurpose.MARKETING_EMAIL,
      granted,
      CONSENT_SOURCE_PRIVACY_PAGE,
    );
    return { granted };
  }

  /** Current marketing-consent state for the UI (fail-closed). */
  async getMarketingConsent(userId: string): Promise<{ granted: boolean }> {
    return { granted: await this.canMarket(userId) };
  }
}
