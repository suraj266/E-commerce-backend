import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  NewsletterCampaignRecipientStatus,
  NewsletterCampaignStatus,
  NewsletterStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { OUTBOX_EVENT, OUTBOX_QUEUE } from '@/modules/outbox/outbox.constants';
import { PrivacyService } from '@/modules/compliance/privacy/privacy.service';
import { config } from '@/common/config/config';
import { SubscribeNewsletterInput } from './dto/subscribe-newsletter.input';
import { CreateNewsletterCampaignInput } from './dto/create-newsletter-campaign.input';
import {
  NEWSLETTER_CAMPAIGN_BATCH_SIZE,
  NEWSLETTER_CAMPAIGN_TEMPLATE,
  NEWSLETTER_CONFIRM_PATH,
  NEWSLETTER_CONFIRM_TEMPLATE,
  NEWSLETTER_CONFIRM_TTL_HOURS,
  NEWSLETTER_UNSUBSCRIBE_PATH,
} from './newsletter.constants';

@Injectable()
export class NewsletterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    // OutboxService is @Global (OutboxCoreModule) — enqueues the confirm email
    // atomically with the PENDING subscription write.
    private readonly outbox: OutboxService,
    // PrivacyService (via PrivacyModule) — the DPDP marketing-consent gate used
    // by filterMarketableRecipients (P3-08 WIRE-CONSENT).
    private readonly privacy: PrivacyService,
  ) {}

  /**
   * Idempotent public subscribe — DOUBLE OPT-IN (P3-08).
   *
   * Creates a new PENDING row (or refreshes an existing PENDING/UNSUBSCRIBED row
   * back to PENDING) with a fresh single-use confirmation token, and enqueues a
   * durable `newsletter.confirm` email INSIDE the same transaction as the write
   * (canonical outbox — "we owe a confirm email" commits with the subscription).
   * The subscriber is NOT marketable until they click the link
   * (confirmNewsletter). An already-ACTIVE address is a no-op — never downgraded
   * back to PENDING. Never leaks whether an address was already on file.
   */
  async subscribe(input: SubscribeNewsletterInput) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.newsletterSubscription.findUnique({
      where: { email },
    });

    // Already confirmed — do nothing (don't reset a live subscriber to PENDING).
    if (existing?.status === NewsletterStatus.ACTIVE) {
      return { ok: true, message: 'already-subscribed' };
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + NEWSLETTER_CONFIRM_TTL_HOURS * 3600 * 1000,
    );

    await this.prisma.$transaction(async (tx) => {
      let subscriptionId: string;
      if (!existing) {
        const created = await tx.newsletterSubscription.create({
          data: {
            email,
            source: input.source ?? null,
            status: NewsletterStatus.PENDING,
            confirmToken: token,
            confirmTokenExpiresAt: expiresAt,
          },
        });
        subscriptionId = created.id;
      } else {
        // PENDING (resend) or UNSUBSCRIBED (re-subscribe) → fresh token, PENDING.
        await tx.newsletterSubscription.update({
          where: { id: existing.id },
          data: {
            status: NewsletterStatus.PENDING,
            confirmToken: token,
            confirmTokenExpiresAt: expiresAt,
            confirmedAt: null,
            unsubscribedAt: null,
            source: input.source ?? existing.source,
          },
        });
        subscriptionId = existing.id;
      }

      // WIRE-OUTBOX: type=newsletter.confirm queue=emails
      // handler=NewsletterService.sendNewsletterConfirmEmail
      // payload={ subscriptionId }. Dispatched by EmailsProcessor.
      await this.outbox.enqueue(tx, {
        type: OUTBOX_EVENT.NEWSLETTER_CONFIRM,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { subscriptionId },
        dedupeKey: `newsletter:confirm:${token}`,
      });
    });

    return {
      ok: true,
      message: existing ? 'confirmation-resent' : 'confirmation-sent',
    };
  }

  /**
   * Public double opt-in confirmation. Flips PENDING -> ACTIVE for the matching
   * token. Idempotent + safe:
   *   - Unknown token → false.
   *   - Already ACTIVE (link clicked twice) → true (idempotent success).
   *   - UNSUBSCRIBED → false (a stale token must not silently re-subscribe).
   *   - Expired PENDING token → false (must re-subscribe for a fresh token).
   * The flip is a conditional updateMany so two concurrent clicks can't
   * double-process; the loser re-reads and still reports success if now ACTIVE.
   */
  async confirmNewsletter(token: string): Promise<boolean> {
    const clean = token?.trim();
    if (!clean) return false;

    const sub = await this.prisma.newsletterSubscription.findUnique({
      where: { confirmToken: clean },
    });
    if (!sub) return false;
    if (sub.status === NewsletterStatus.ACTIVE) return true; // idempotent replay
    if (sub.status !== NewsletterStatus.PENDING) return false; // UNSUBSCRIBED
    if (
      sub.confirmTokenExpiresAt &&
      sub.confirmTokenExpiresAt.getTime() < Date.now()
    ) {
      return false; // expired
    }

    const res = await this.prisma.newsletterSubscription.updateMany({
      where: { id: sub.id, status: NewsletterStatus.PENDING },
      data: { status: NewsletterStatus.ACTIVE, confirmedAt: new Date() },
    });
    if (res.count > 0) return true;

    // Lost the concurrent race — success only if the other writer made it ACTIVE.
    const now = await this.prisma.newsletterSubscription.findUnique({
      where: { id: sub.id },
      select: { status: true },
    });
    return now?.status === NewsletterStatus.ACTIVE;
  }

  /**
   * Outbox handler for `newsletter.confirm`. Re-reads the subscription by id and
   * emails the confirmation link built from its CURRENT token (so a re-subscribe
   * that refreshed the token always mails the live one). No-op once the row is
   * no longer PENDING (already confirmed/unsubscribed — idempotent replay).
   *
   * TRANSACTIONAL, not marketing: this email is how we CAPTURE consent, so it is
   * intentionally NOT gated on canMarket (see filterMarketableRecipients).
   * Throws on a genuine send failure so the outbox retries; a SKIPPED send (SMTP
   * off / template disabled) is an intentional no-op.
   */
  async sendNewsletterConfirmEmail(subscriptionId: string): Promise<void> {
    const sub = await this.prisma.newsletterSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub) return;
    if (sub.status !== NewsletterStatus.PENDING) return; // nothing to confirm
    if (!sub.confirmToken) return;

    const base = config.FRONTEND_URL ?? '';
    const confirmLink = `${base}${NEWSLETTER_CONFIRM_PATH}?token=${encodeURIComponent(
      sub.confirmToken,
    )}`;

    const result = await this.email.send(NEWSLETTER_CONFIRM_TEMPLATE, sub.email, {
      confirmLink,
    });
    if (!result.sent && !result.skipped) {
      throw new Error(`newsletter_confirm email failed: ${result.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Marketing consent gate (P3-08 WIRE-CONSENT)
  // ---------------------------------------------------------------------------

  /**
   * DPDP marketing-consent gate for newsletter BROADCAST sends. Given candidate
   * recipient emails, returns only those we may lawfully market to:
   *   - An email tied to a registered User is kept ONLY if
   *     PrivacyService.canMarket(userId) is true (fail-closed — a user who
   *     revoked marketing consent on their privacy page is dropped).
   *   - An email with NO User account is a pure double-opt-in newsletter
   *     subscriber whose confirmation is their consent → kept.
   *
   * There is NO bulk marketing-broadcast send loop in the codebase yet; when one
   * is built it MUST pass its ACTIVE recipients through this method before
   * dispatch. The double-opt-in CONFIRMATION email is transactional (it captures
   * consent) and is intentionally NOT gated here.
   */
  async filterMarketableRecipients(emails: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const email of emails) {
      const normalized = email.trim().toLowerCase();
      const user = await this.prisma.user.findUnique({
        where: { email: normalized },
        select: { id: true },
      });
      if (!user) {
        out.push(email); // email-only subscriber — no in-app consent state
        continue;
      }
      if (await this.privacy.canMarket(user.id)) out.push(email);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async findAllPaginated(opts: {
    status?: NewsletterStatus;
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: Prisma.NewsletterSubscriptionWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.search && opts.search.trim()) {
      where.email = { contains: opts.search.trim(), mode: 'insensitive' };
    }

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.newsletterSubscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.newsletterSubscription.count({ where }),
    ]);

    return {
      items,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  async unsubscribe(id: string) {
    const row = await this.prisma.newsletterSubscription.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Subscription not found');
    return this.prisma.newsletterSubscription.update({
      where: { id },
      data: {
        status: NewsletterStatus.UNSUBSCRIBED,
        unsubscribedAt: new Date(),
      },
    });
  }

  /**
   * PUBLIC one-click unsubscribe from a broadcast email's link. Flips any
   * non-UNSUBSCRIBED row matching the (unguessable) token to UNSUBSCRIBED.
   * Idempotent: an unknown/blank token → false; an already-UNSUBSCRIBED token →
   * true (a re-clicked link is a success, not an error). Never reveals whether a
   * token exists beyond that boolean. This is the unsubscribe honoured by the
   * broadcast delivery handler — a subscriber who unsubscribes after being queued
   * is dropped at delivery time.
   */
  async unsubscribeByToken(token: string): Promise<boolean> {
    const clean = token?.trim();
    if (!clean) return false;
    const sub = await this.prisma.newsletterSubscription.findUnique({
      where: { unsubscribeToken: clean },
      select: { id: true, status: true },
    });
    if (!sub) return false;
    if (sub.status === NewsletterStatus.UNSUBSCRIBED) return true; // idempotent
    await this.prisma.newsletterSubscription.updateMany({
      where: { id: sub.id, status: { not: NewsletterStatus.UNSUBSCRIBED } },
      data: {
        status: NewsletterStatus.UNSUBSCRIBED,
        unsubscribedAt: new Date(),
      },
    });
    return true;
  }

  // ===========================================================================
  // Broadcast campaigns (P3 Wave 4) — consent-gated bulk marketing send.
  // ===========================================================================

  /** Compose a new DRAFT campaign. No recipients are touched until it is sent. */
  async createCampaign(input: CreateNewsletterCampaignInput, actorUserId?: string) {
    return this.prisma.newsletterCampaign.create({
      data: {
        subject: input.subject.trim(),
        htmlBody: input.htmlBody,
        createdByUserId: actorUserId ?? null,
        status: NewsletterCampaignStatus.DRAFT,
      },
    });
  }

  async findCampaignsPaginated(opts: {
    status?: NewsletterCampaignStatus;
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: Prisma.NewsletterCampaignWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.search && opts.search.trim()) {
      where.subject = { contains: opts.search.trim(), mode: 'insensitive' };
    }

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.newsletterCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.newsletterCampaign.count({ where }),
    ]);

    return {
      items,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  async findCampaign(id: string) {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  /**
   * Trigger a campaign send. WINNER-ELECT: conditionally flips DRAFT -> SENDING
   * and enqueues the durable `newsletter.campaign_send` fan-out event INSIDE the
   * same transaction (canonical outbox — "we owe a broadcast" commits with the
   * status flip). Idempotent:
   *   - Already SENDING/SENT → no-op, returns the current row (a second click or
   *     a concurrent caller never starts a second fan-out).
   * The heavy per-recipient work runs in the worker (dispatchCampaign), so this
   * request returns immediately.
   */
  async sendCampaign(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const flip = await tx.newsletterCampaign.updateMany({
        where: { id, status: NewsletterCampaignStatus.DRAFT },
        data: {
          status: NewsletterCampaignStatus.SENDING,
          sendStartedAt: new Date(),
        },
      });

      const campaign = await tx.newsletterCampaign.findUnique({ where: { id } });
      if (!campaign) throw new NotFoundException('Campaign not found');

      // Lost the elect (already SENDING or SENT) — do not enqueue a second
      // fan-out. Return the current state so the caller sees reality.
      if (flip.count === 0) return campaign;

      await this.outbox.enqueue(tx, {
        type: OUTBOX_EVENT.NEWSLETTER_CAMPAIGN_SEND,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { campaignId: id },
        dedupeKey: `newsletter:campaign_send:${id}`,
      });

      return campaign;
    });
  }

  /**
   * Outbox handler for `newsletter.campaign_send`. Fans one campaign out over
   * every ACTIVE subscriber in id-ordered batches:
   *   - Each batch is run through the DPDP consent gate
   *     (filterMarketableRecipients): a registered user who revoked marketing
   *     consent is DROPPED (fail-closed); an email-only double-opt-in subscriber
   *     is kept (their confirmation is their consent).
   *   - A per-(campaign,subscriber) recipient row is written (QUEUED for kept,
   *     SKIPPED for dropped) and, for each kept recipient, a durable
   *     `newsletter.campaign_deliver` event is enqueued — all in one transaction
   *     per batch.
   * RESUMABLE + IDEMPOTENT: recipient rows use `skipDuplicates` and the delivery
   * enqueue uses a unique dedupeKey, so a redelivery/crash mid-fan-out never
   * double-writes or double-enqueues. Counts are RECOMPUTED from the recipient
   * ledger at the end (not incremented), so finalizing is idempotent too. An
   * already-SENT campaign is a no-op.
   */
  async dispatchCampaign(campaignId: string): Promise<void> {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) return;
    if (campaign.status === NewsletterCampaignStatus.SENT) return; // replay

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.newsletterSubscription.findMany({
        where: { status: NewsletterStatus.ACTIVE },
        orderBy: { id: 'asc' },
        take: NEWSLETTER_CAMPAIGN_BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: { id: true, email: true },
      });
      if (batch.length === 0) break;

      const marketable = new Set(
        await this.filterMarketableRecipients(batch.map((b) => b.email)),
      );

      await this.prisma.$transaction(async (tx) => {
        for (const sub of batch) {
          const keep = marketable.has(sub.email);
          await tx.newsletterCampaignRecipient.createMany({
            data: [
              {
                campaignId,
                subscriptionId: sub.id,
                email: sub.email,
                status: keep
                  ? NewsletterCampaignRecipientStatus.QUEUED
                  : NewsletterCampaignRecipientStatus.SKIPPED,
                skipReason: keep ? null : 'consent-revoked',
              },
            ],
            skipDuplicates: true,
          });
          if (keep) {
            await this.outbox.enqueue(tx, {
              type: OUTBOX_EVENT.NEWSLETTER_CAMPAIGN_DELIVER,
              queue: OUTBOX_QUEUE.EMAILS,
              payload: { campaignId, subscriptionId: sub.id },
              dedupeKey: `newsletter:deliver:${campaignId}:${sub.id}`,
            });
          }
        }
      });

      cursor = batch[batch.length - 1].id;
    }

    // Finalize counts from the ledger (idempotent — recomputed, not incremented).
    const [recipientCount, sentCount, skippedCount] =
      await this.prisma.$transaction([
        this.prisma.newsletterCampaignRecipient.count({ where: { campaignId } }),
        this.prisma.newsletterCampaignRecipient.count({
          where: {
            campaignId,
            status: {
              in: [
                NewsletterCampaignRecipientStatus.QUEUED,
                NewsletterCampaignRecipientStatus.SENT,
              ],
            },
          },
        }),
        this.prisma.newsletterCampaignRecipient.count({
          where: {
            campaignId,
            status: NewsletterCampaignRecipientStatus.SKIPPED,
          },
        }),
      ]);

    await this.prisma.newsletterCampaign.updateMany({
      where: { id: campaignId, status: NewsletterCampaignStatus.SENDING },
      data: {
        status: NewsletterCampaignStatus.SENT,
        sentAt: new Date(),
        recipientCount,
        sentCount,
        skippedCount,
      },
    });
  }

  /**
   * Outbox handler for `newsletter.campaign_deliver` — sends ONE recipient's copy
   * of a broadcast. Re-reads the subscription (source of truth) and:
   *   - No-ops if the campaign/subscription is gone.
   *   - RESPECTS UNSUBSCRIBE: if the address is no longer ACTIVE (unsubscribed
   *     after being queued), marks the recipient SKIPPED and sends nothing.
   *   - No-ops if this recipient is already SENT (idempotent replay).
   * Otherwise it lazily mints the subscriber's stable unsubscribe token, renders
   * the wrapper template with the campaign subject/body + unsubscribe link, and
   * marks the recipient SENT. Throws on a genuine send failure so the outbox
   * retries; a SKIPPED send (SMTP off / template disabled) is an intentional
   * no-op that still advances the recipient to SENT.
   */
  async deliverCampaignEmail(
    campaignId: string,
    subscriptionId: string,
  ): Promise<void> {
    const campaign = await this.prisma.newsletterCampaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) return;

    const sub = await this.prisma.newsletterSubscription.findUnique({
      where: { id: subscriptionId },
    });
    if (!sub) return;

    if (sub.status !== NewsletterStatus.ACTIVE) {
      // Unsubscribed (or otherwise inactive) after being queued — honour it.
      await this.markRecipient(
        campaignId,
        subscriptionId,
        NewsletterCampaignRecipientStatus.SKIPPED,
        'unsubscribed',
      );
      return;
    }

    // RE-CHECK the DPDP marketing-consent gate at DELIVERY time, not just at
    // dispatch. Marketing-consent revocation (privacy page) appends a
    // ConsentRecord but does NOT flip NewsletterSubscription.status, so a user
    // who withdrew consent during the dispatch→deliver window would still be
    // ACTIVE here. Fail-closed: if a registered user is no longer marketable,
    // skip the send. (review #1)
    const marketable = await this.filterMarketableRecipients([sub.email]);
    if (marketable.length === 0) {
      await this.markRecipient(
        campaignId,
        subscriptionId,
        NewsletterCampaignRecipientStatus.SKIPPED,
        'consent-revoked',
      );
      return;
    }

    const recipient =
      await this.prisma.newsletterCampaignRecipient.findUnique({
        where: {
          campaignId_subscriptionId: { campaignId, subscriptionId },
        },
        select: { status: true },
      });
    if (recipient?.status === NewsletterCampaignRecipientStatus.SENT) return;

    const unsubscribeToken = await this.ensureUnsubscribeToken(
      subscriptionId,
      sub.unsubscribeToken,
    );
    const base = config.FRONTEND_URL ?? '';
    const unsubscribeLink = `${base}${NEWSLETTER_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(
      unsubscribeToken,
    )}`;

    const result = await this.email.send(
      NEWSLETTER_CAMPAIGN_TEMPLATE,
      sub.email,
      {
        subject: campaign.subject,
        body: campaign.htmlBody,
        unsubscribeLink,
      },
    );
    if (!result.sent && !result.skipped) {
      throw new Error(`newsletter_campaign email failed: ${result.message}`);
    }

    await this.markRecipient(
      campaignId,
      subscriptionId,
      NewsletterCampaignRecipientStatus.SENT,
      null,
    );
  }

  /**
   * Lazily mint (once) the subscriber's stable unsubscribe token. Uses a
   * conditional updateMany (WHERE unsubscribeToken IS NULL) so concurrent
   * deliveries across campaigns can't clobber each other; always re-reads the
   * committed value so every email links the SAME live token.
   */
  private async ensureUnsubscribeToken(
    subscriptionId: string,
    current: string | null,
  ): Promise<string> {
    if (current) return current;
    const token = randomBytes(24).toString('base64url');
    await this.prisma.newsletterSubscription.updateMany({
      where: { id: subscriptionId, unsubscribeToken: null },
      data: { unsubscribeToken: token },
    });
    const row = await this.prisma.newsletterSubscription.findUnique({
      where: { id: subscriptionId },
      select: { unsubscribeToken: true },
    });
    return row?.unsubscribeToken ?? token;
  }

  /** Idempotent recipient status stamp (no-op if the row was never created). */
  private async markRecipient(
    campaignId: string,
    subscriptionId: string,
    status: NewsletterCampaignRecipientStatus,
    skipReason: string | null,
  ): Promise<void> {
    await this.prisma.newsletterCampaignRecipient.updateMany({
      where: { campaignId, subscriptionId },
      data: {
        status,
        skipReason,
        ...(status === NewsletterCampaignRecipientStatus.SENT
          ? { sentAt: new Date() }
          : {}),
      },
    });
  }
}
