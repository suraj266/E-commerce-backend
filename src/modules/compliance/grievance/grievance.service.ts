/**
 * GrievanceService — CP-EC Rules 2020 complaint-redressal engine (Phase 4, P4-01).
 *
 * A Grievance walks a GUARDED state machine (see grievance.constants.ts). Every
 * legal transition is applied with a CONDITIONAL updateMany (`where: { status:
 * <expected> }`) so a redelivered job / racing caller / retry can only move the
 * machine ONCE — the loser reads count===0 and no-ops (same pattern as
 * ReturnsService). Each transition appends an append-only GrievanceMessage and,
 * for customer-visible changes, enqueues a durable outbox email + writes an
 * in-app bell.
 *
 * SLA: each ticket gets an `slaDueAt` derived from its priority
 * (GRIEVANCE_SLA_HOURS — // NEEDS LEGAL SIGN-OFF). `runSlaEscalation` (invoked by
 * the daily cron) flips any still-open ticket past its deadline to ESCALATED.
 *
 * Reporting: `buildMonthlyComplianceReport(period)` rolls the ledger up into the
 * CP-EC monthly compliance report (counts / resolutions / avg-resolution-time).
 * It COMPUTES only — publishing/filing the report is a MANUAL Legal action.
 *
 * Nothing here moves money; the service is pure workflow + comms.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GrievanceAuthorRole,
  GrievanceCategory,
  GrievancePriority,
  GrievanceStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { OUTBOX_QUEUE } from '@/modules/outbox/outbox.constants';
import { NotificationService } from '@/modules/notification/notification.service';
import { AuditService } from '@/modules/observability/audit/audit.service';
import { FileGrievanceInput } from './dto/file-grievance.input';
import { GrievanceMessageInput } from './dto/grievance-message.input';
import { AssignGrievanceInput } from './dto/assign-grievance.input';
import { ResolveGrievanceInput } from './dto/resolve-grievance.input';
import {
  GrievanceEntity,
  GrievanceMessageEntity,
} from './entities/grievance.entities';
import {
  computeSlaDueAt,
  defaultPriorityForCategory,
  generateTicketNumber,
  GRIEVANCE_OPEN_STATUSES,
  GRIEVANCE_OUTBOX_EVENT,
  GRIEVANCE_REPORT_DISCLAIMER,
  isValidGrievanceTransition,
} from './grievance.constants';

/** `YYYY-MM` for a date, local calendar (matches the TCS/invoice period calc). */
export function toGrievancePeriod(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** [start, end) Date bounds for a `YYYY-MM` period. */
export function grievancePeriodBounds(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map((n) => parseInt(n, 10));
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

/** A Grievance row (scalar fields only). */
type GrievanceRow = Prisma.GrievanceGetPayload<Record<string, never>>;
/** A GrievanceMessage row (scalar fields only). */
type GrievanceMessageRow = Prisma.GrievanceMessageGetPayload<Record<string, never>>;

@Injectable()
export class GrievanceService {
  private readonly logger = new Logger(GrievanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    // @Global NotificationService (P3-08) — the bell entry alongside each email.
    @Optional() private readonly notifications?: NotificationService,
    // @Global AuditService (P3-05) — best-effort trail of the compliance actions.
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ===========================================================================
  // Customer
  // ===========================================================================

  /**
   * File a new complaint. Derives priority + SLA from the category, opens the
   * ticket at OPEN with the description as the first (customer) thread message,
   * enqueues the acknowledgement email, and writes the customer's confirmation
   * bell.
   */
  async fileGrievance(
    userId: string,
    input: FileGrievanceInput,
  ): Promise<GrievanceEntity> {
    const priority = defaultPriorityForCategory(input.category);
    const now = new Date();
    const slaDueAt = computeSlaDueAt(priority, now);
    const ticketNumber = generateTicketNumber(now);

    const created = await this.prisma.$transaction(async (tx) => {
      const g = await tx.grievance.create({
        data: {
          ticketNumber,
          raisedByUserId: userId,
          contactEmail: input.contactEmail ?? null,
          orderId: input.orderId ?? null,
          sellerOrderId: input.sellerOrderId ?? null,
          category: input.category,
          subject: input.subject,
          description: input.description,
          status: GrievanceStatus.OPEN,
          priority,
          slaDueAt,
          messages: {
            create: {
              authorUserId: userId,
              authorRole: GrievanceAuthorRole.CUSTOMER,
              body: input.description,
            },
          },
        },
        include: { messages: true },
      });
      await this.outbox.enqueue(tx, {
        type: GRIEVANCE_OUTBOX_EVENT.FILED,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: { grievanceId: g.id },
        dedupeKey: `grievance-filed:${g.id}`,
      });
      return g;
    });

    await this.notifications?.create({
      userId,
      type: 'grievance_filed',
      title: 'Complaint received',
      body: `We've logged your complaint ${created.ticketNumber} and will respond shortly.`,
      data: {
        grievanceId: created.id,
        ticketNumber: created.ticketNumber,
        link: `/account/grievances/${created.id}`,
      },
      dedupeKey: `notif:grievance_filed:${created.id}`,
    });

    return this.mapGrievance(created, { includeInternal: false });
  }

  /** The customer's own grievances, newest first (no message thread). */
  async myGrievances(userId: string): Promise<GrievanceEntity[]> {
    const rows = await this.prisma.grievance.findMany({
      where: { raisedByUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.mapGrievance(r));
  }

  /** One of the customer's own grievances with its (public) thread. */
  async myGrievanceDetail(
    userId: string,
    id: string,
  ): Promise<GrievanceEntity> {
    const g = await this.prisma.grievance.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!g || g.raisedByUserId !== userId) {
      throw new NotFoundException('Complaint not found.');
    }
    return this.mapGrievance(g, { includeInternal: false });
  }

  /**
   * Customer adds a reply to their own grievance thread. A reply on a RESOLVED
   * ticket re-opens it (RESOLVED → IN_PROGRESS) so the officer picks it back up;
   * a CLOSED ticket is terminal and cannot be replied to.
   */
  async replyToGrievance(
    userId: string,
    grievanceId: string,
    body: string,
  ): Promise<GrievanceEntity> {
    // Validate the raw scalar body at the edge (the customer arg carries no
    // class-validator decorators, unlike the officer GrievanceMessageInput):
    // reject empty/whitespace (the DB CHECK would otherwise 500) + cap length.
    const trimmed = (body ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 4000) {
      throw new BadRequestException(
        'Your reply must be between 1 and 4000 characters.',
      );
    }
    const g = await this.requireGrievance(grievanceId);
    if (g.raisedByUserId !== userId) {
      throw new ForbiddenException('This is not your complaint.');
    }
    if (g.status === GrievanceStatus.CLOSED) {
      throw new BadRequestException(
        'This complaint is closed. Please file a new complaint if the issue persists.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.writeMessage(tx, grievanceId, {
        authorUserId: userId,
        authorRole: GrievanceAuthorRole.CUSTOMER,
        body: trimmed,
      });
      // Re-open a resolved ticket on a customer reply (guarded flip). CLEAR the
      // stale resolvedAt/resolutionNote — otherwise a re-opened, still-open
      // complaint keeps a past resolvedAt and is mis-counted in the monthly
      // CP-EC compliance report as both resolved AND not-pending.
      if (g.status === GrievanceStatus.RESOLVED) {
        const flip = await tx.grievance.updateMany({
          where: { id: grievanceId, status: GrievanceStatus.RESOLVED },
          data: {
            status: GrievanceStatus.IN_PROGRESS,
            resolvedAt: null,
            resolutionNote: null,
          },
        });
        if (flip.count > 0) {
          await this.writeMessage(tx, grievanceId, {
            authorRole: GrievanceAuthorRole.SYSTEM,
            body: 'Re-opened after customer reply.',
          });
        }
      }
    });

    // Nudge the assigned officer (best-effort bell) that the customer replied.
    if (g.assignedToUserId) {
      await this.notifications?.create({
        userId: g.assignedToUserId,
        type: 'grievance_customer_reply',
        title: 'Customer replied',
        body: `Complaint ${g.ticketNumber} has a new customer message.`,
        data: {
          grievanceId,
          ticketNumber: g.ticketNumber,
          link: `/admin/grievances`,
        },
      });
    }

    return this.adminGrievanceDetail(grievanceId, { includeInternal: false });
  }

  // ===========================================================================
  // Officer / Admin
  // ===========================================================================

  async listGrievances(filter: {
    status?: GrievanceStatus;
    category?: GrievanceCategory;
    priority?: GrievancePriority;
    assignedToUserId?: string;
    breachedOnly?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const where: Prisma.GrievanceWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.assignedToUserId
        ? { assignedToUserId: filter.assignedToUserId }
        : {}),
      ...(filter.breachedOnly
        ? { status: { in: GRIEVANCE_OPEN_STATUSES }, slaDueAt: { lt: new Date() } }
        : {}),
    };
    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.grievance.findMany({
        where,
        orderBy: [{ slaDueAt: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.grievance.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.mapGrievance(r)),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  /** Any grievance's detail with the full thread (internal notes included). */
  async adminGrievanceDetail(
    id: string,
    opts: { includeInternal?: boolean } = { includeInternal: true },
  ): Promise<GrievanceEntity> {
    const g = await this.prisma.grievance.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!g) throw new NotFoundException('Complaint not found.');
    return this.mapGrievance(g, {
      includeInternal: opts.includeInternal ?? true,
    });
  }

  /**
   * Officer takes / re-assigns a ticket, optionally re-prioritising it (which
   * recomputes the SLA deadline). Moves OPEN → IN_PROGRESS (records first
   * response) and notifies both the new officer and the complainant.
   */
  async assignGrievance(
    actorUserId: string,
    input: AssignGrievanceInput,
  ): Promise<GrievanceEntity> {
    const g = await this.requireGrievance(input.grievanceId);
    if (g.status === GrievanceStatus.CLOSED) {
      throw new BadRequestException('A closed complaint cannot be reassigned.');
    }
    const nextPriority = input.priority ?? g.priority;
    const slaDueAt =
      input.priority && input.priority !== g.priority
        ? computeSlaDueAt(nextPriority, g.createdAt)
        : g.slaDueAt;

    const movesToInProgress = g.status === GrievanceStatus.OPEN;
    await this.prisma.$transaction(async (tx) => {
      // GUARDED write (review #3): the decision above was made on a pre-tx read.
      // Constrain the update to the exact state it assumed — OPEN when we intend
      // the IN_PROGRESS flip, else the non-terminal assignable states — so a
      // concurrent resolve/close/escalate can't be clobbered (no CLOSED→
      // IN_PROGRESS resurrection or silent de-escalation). count===0 → abort.
      const guardStatuses = movesToInProgress
        ? [GrievanceStatus.OPEN]
        : [GrievanceStatus.IN_PROGRESS, GrievanceStatus.ESCALATED];
      const upd = await tx.grievance.updateMany({
        where: { id: g.id, status: { in: guardStatuses } },
        data: {
          assignedToUserId: input.assigneeUserId,
          priority: nextPriority,
          slaDueAt,
          ...(movesToInProgress
            ? {
                status: GrievanceStatus.IN_PROGRESS,
                firstResponseAt: g.firstResponseAt ?? new Date(),
              }
            : {}),
        },
      });
      if (upd.count === 0) {
        throw new BadRequestException(
          'This complaint changed state — reload and try again.',
        );
      }
      await this.writeMessage(tx, g.id, {
        authorUserId: actorUserId,
        authorRole: GrievanceAuthorRole.SYSTEM,
        body: `Assigned to officer${
          input.priority ? ` · priority ${nextPriority}` : ''
        }.`,
        internal: true,
      });
      if (movesToInProgress) {
        await this.enqueueStatus(tx, g.id, GrievanceStatus.IN_PROGRESS);
      }
    });

    await this.notifications?.create({
      userId: input.assigneeUserId,
      type: 'grievance_assigned',
      title: 'Complaint assigned to you',
      body: `Complaint ${g.ticketNumber} is now yours to handle.`,
      data: {
        grievanceId: g.id,
        ticketNumber: g.ticketNumber,
        link: `/admin/grievances`,
      },
      dedupeKey: `notif:grievance_assigned:${g.id}:${input.assigneeUserId}`,
    });

    return this.adminGrievanceDetail(g.id);
  }

  /**
   * Officer posts a response on the thread. A PUBLIC reply emails + bells the
   * complainant and moves OPEN → IN_PROGRESS (records first response); an
   * INTERNAL note stays officer-only and does neither.
   */
  async respondToGrievance(
    actorUserId: string,
    input: GrievanceMessageInput,
  ): Promise<GrievanceEntity> {
    const g = await this.requireGrievance(input.grievanceId);
    if (g.status === GrievanceStatus.CLOSED) {
      throw new BadRequestException('A closed complaint cannot be responded to.');
    }
    const internal = input.internal ?? false;

    const messageId = await this.prisma.$transaction(async (tx) => {
      const msg = await this.writeMessage(tx, g.id, {
        authorUserId: actorUserId,
        authorRole: GrievanceAuthorRole.OFFICER,
        body: input.body,
        internal,
      });
      if (!internal) {
        const movesToInProgress = g.status === GrievanceStatus.OPEN;
        if (movesToInProgress || !g.firstResponseAt) {
          // GUARDED write (review #3): only the state the pre-tx read assumed,
          // so a concurrent resolve/close can't be overwritten to IN_PROGRESS.
          const guardStatuses = movesToInProgress
            ? [GrievanceStatus.OPEN]
            : [GrievanceStatus.IN_PROGRESS, GrievanceStatus.ESCALATED];
          await tx.grievance.updateMany({
            where: { id: g.id, status: { in: guardStatuses } },
            data: {
              firstResponseAt: g.firstResponseAt ?? new Date(),
              ...(movesToInProgress
                ? { status: GrievanceStatus.IN_PROGRESS }
                : {}),
            },
          });
        }
        await this.outbox.enqueue(tx, {
          type: GRIEVANCE_OUTBOX_EVENT.REPLY,
          queue: OUTBOX_QUEUE.EMAILS,
          payload: { grievanceId: g.id, messageId: msg.id },
          dedupeKey: `grievance-reply:${msg.id}`,
        });
      }
      return msg.id;
    });

    this.logger.log(
      `Grievance ${g.ticketNumber} — officer ${internal ? 'note' : 'reply'} ${messageId}.`,
    );
    return this.adminGrievanceDetail(g.id);
  }

  /**
   * Officer records the resolution and moves the ticket to RESOLVED. Guarded:
   * only from OPEN / IN_PROGRESS / ESCALATED. Emails + bells the complainant the
   * resolution note.
   */
  async resolveGrievance(
    actorUserId: string,
    input: ResolveGrievanceInput,
  ): Promise<GrievanceEntity> {
    const g = await this.requireGrievance(input.grievanceId);
    this.assertTransition(g.status, GrievanceStatus.RESOLVED);

    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.grievance.updateMany({
        where: {
          id: g.id,
          status: { in: [GrievanceStatus.OPEN, GrievanceStatus.IN_PROGRESS, GrievanceStatus.ESCALATED] },
        },
        data: {
          status: GrievanceStatus.RESOLVED,
          resolutionNote: input.resolutionNote,
          resolvedAt: new Date(),
          firstResponseAt: g.firstResponseAt ?? new Date(),
        },
      });
      if (flip.count === 0) return; // already advanced → no-op
      await this.writeMessage(tx, g.id, {
        authorUserId: actorUserId,
        authorRole: GrievanceAuthorRole.OFFICER,
        body: `Resolution: ${input.resolutionNote}`,
      });
      await this.enqueueStatus(tx, g.id, GrievanceStatus.RESOLVED);
    });

    await this.audit?.record({
      action: 'grievance.resolved',
      entityType: 'Grievance',
      entityId: g.id,
      actorUserId,
      before: { status: g.status },
      after: { status: GrievanceStatus.RESOLVED },
    });
    return this.adminGrievanceDetail(g.id);
  }

  /**
   * Officer / senior manually escalates a still-open ticket (OPEN/IN_PROGRESS →
   * ESCALATED). Same target the SLA cron drives to, but actor-initiated.
   */
  async escalateGrievance(
    actorUserId: string,
    grievanceId: string,
    note?: string,
  ): Promise<GrievanceEntity> {
    const g = await this.requireGrievance(grievanceId);
    this.assertTransition(g.status, GrievanceStatus.ESCALATED);
    await this.applyEscalation(grievanceId, actorUserId, note ?? 'Escalated by officer.');
    return this.adminGrievanceDetail(grievanceId);
  }

  /**
   * Officer closes a RESOLVED ticket (RESOLVED → CLOSED). Terminal; bells the
   * complainant the closure.
   */
  async closeGrievance(
    actorUserId: string,
    grievanceId: string,
  ): Promise<GrievanceEntity> {
    const g = await this.requireGrievance(grievanceId);
    this.assertTransition(g.status, GrievanceStatus.CLOSED);

    await this.prisma.$transaction(async (tx) => {
      const flip = await tx.grievance.updateMany({
        where: { id: grievanceId, status: GrievanceStatus.RESOLVED },
        data: { status: GrievanceStatus.CLOSED, closedAt: new Date() },
      });
      if (flip.count === 0) return;
      await this.writeMessage(tx, grievanceId, {
        authorUserId: actorUserId,
        authorRole: GrievanceAuthorRole.SYSTEM,
        body: 'Complaint closed.',
      });
      await this.enqueueStatus(tx, grievanceId, GrievanceStatus.CLOSED);
    });
    return this.adminGrievanceDetail(grievanceId);
  }

  // ===========================================================================
  // SLA escalation (invoked by GrievanceSlaCron)
  // ===========================================================================

  /**
   * Flag + escalate every still-open ticket past its SLA deadline. Each is moved
   * with a guarded conditional flip so a concurrent officer action / a re-run
   * never double-escalates. Returns the number escalated.
   */
  async runSlaEscalation(now: Date = new Date()): Promise<number> {
    const overdue = await this.prisma.grievance.findMany({
      where: { status: { in: GRIEVANCE_OPEN_STATUSES }, slaDueAt: { lt: now } },
      select: { id: true },
      take: 200,
    });
    let escalated = 0;
    for (const row of overdue) {
      try {
        const did = await this.applyEscalation(
          row.id,
          null,
          'SLA breached — auto-escalated.',
        );
        if (did) escalated++;
      } catch (e) {
        this.logger.warn(
          `Grievance ${row.id} SLA escalation failed: ${(e as Error).message}`,
        );
      }
    }
    if (escalated > 0) {
      this.logger.warn(`SLA breach: auto-escalated ${escalated} grievance(s).`);
    }
    return escalated;
  }

  /**
   * Shared escalation: OPEN/IN_PROGRESS → ESCALATED via a guarded flip, append a
   * message, enqueue the customer status email + notify the assigned officer.
   * Returns true when THIS call performed the flip. `actorUserId=null` = system.
   */
  private async applyEscalation(
    grievanceId: string,
    actorUserId: string | null,
    note: string,
  ): Promise<boolean> {
    const flipped = await this.prisma.$transaction(async (tx) => {
      const flip = await tx.grievance.updateMany({
        where: { id: grievanceId, status: { in: GRIEVANCE_OPEN_STATUSES } },
        data: { status: GrievanceStatus.ESCALATED, escalatedAt: new Date() },
      });
      if (flip.count === 0) return false;
      await this.writeMessage(tx, grievanceId, {
        authorUserId: actorUserId ?? undefined,
        authorRole: actorUserId
          ? GrievanceAuthorRole.OFFICER
          : GrievanceAuthorRole.SYSTEM,
        body: note,
      });
      await this.enqueueStatus(tx, grievanceId, GrievanceStatus.ESCALATED);
      return true;
    });

    if (flipped) {
      const g = await this.prisma.grievance.findUnique({
        where: { id: grievanceId },
        select: { ticketNumber: true, assignedToUserId: true },
      });
      if (g?.assignedToUserId) {
        await this.notifications?.create({
          userId: g.assignedToUserId,
          type: 'grievance_escalated',
          title: 'Complaint escalated',
          body: `Complaint ${g.ticketNumber} breached its SLA and was escalated.`,
          data: { grievanceId, ticketNumber: g.ticketNumber, link: `/admin/grievances` },
          dedupeKey: `notif:grievance_escalated:${grievanceId}`,
        });
      }
    }
    return flipped;
  }

  // ===========================================================================
  // Monthly compliance report (CP-EC Rules 2020)
  // ===========================================================================

  /**
   * Build the CP-EC monthly compliance roll-up for a `YYYY-MM` period: opening
   * backlog, received, resolved/closed, escalated, still-pending, SLA compliance
   * and mean resolution time, plus category/status breakdowns. COMPUTES only —
   * publishing/filing is a manual Legal action. // NEEDS LEGAL SIGN-OFF.
   */
  async buildMonthlyComplianceReport(period: string) {
    const { start, end } = grievancePeriodBounds(period);

    const [
      openingBacklog,
      received,
      closed,
      escalated,
      pending,
      resolvedRows,
      byCategoryRows,
      byStatusRows,
    ] = await this.prisma.$transaction([
      // Unresolved carried into the period (created before start, not resolved before start).
      this.prisma.grievance.count({
        where: {
          createdAt: { lt: start },
          OR: [{ resolvedAt: null }, { resolvedAt: { gte: start } }],
        },
      }),
      this.prisma.grievance.count({ where: { createdAt: { gte: start, lt: end } } }),
      this.prisma.grievance.count({ where: { closedAt: { gte: start, lt: end } } }),
      this.prisma.grievance.count({ where: { escalatedAt: { gte: start, lt: end } } }),
      // Still unresolved at period end.
      this.prisma.grievance.count({
        where: {
          createdAt: { lt: end },
          OR: [{ resolvedAt: null }, { resolvedAt: { gte: end } }],
        },
      }),
      // Resolved within the period — for count, SLA compliance + avg resolution.
      this.prisma.grievance.findMany({
        where: { resolvedAt: { gte: start, lt: end } },
        select: { createdAt: true, resolvedAt: true, slaDueAt: true },
      }),
      this.prisma.grievance.groupBy({
        by: ['category'],
        where: { createdAt: { gte: start, lt: end } },
        _count: { _all: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.grievance.groupBy({
        by: ['status'],
        where: { createdAt: { gte: start, lt: end } },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);

    const resolved = resolvedRows.length;
    let breached = 0;
    let totalHours = 0;
    for (const r of resolvedRows) {
      if (!r.resolvedAt) continue;
      if (r.resolvedAt.getTime() > r.slaDueAt.getTime()) breached++;
      totalHours +=
        (r.resolvedAt.getTime() - r.createdAt.getTime()) / (1000 * 60 * 60);
    }
    const avgResolutionHours =
      resolved > 0 ? Math.round((totalHours / resolved) * 100) / 100 : null;
    const slaComplianceRate =
      resolved > 0
        ? Math.round(((resolved - breached) / resolved) * 10000) / 100
        : null;

    const officer = this.grievanceOfficerFromConfig();

    return {
      period,
      disclaimer: GRIEVANCE_REPORT_DISCLAIMER,
      officerName: officer?.name ?? null,
      officerEmail: officer?.email ?? null,
      officerPhone: officer?.phone ?? null,
      openingBacklog,
      received,
      resolved,
      closed,
      escalated,
      pending,
      slaBreached: breached,
      slaComplianceRate,
      avgResolutionHours,
      byCategory: byCategoryRows.map((r) => ({
        key: r.category,
        count: typeof r._count === 'object' ? (r._count._all ?? 0) : 0,
      })),
      byStatus: byStatusRows.map((r) => ({
        key: r.status,
        count: typeof r._count === 'object' ? (r._count._all ?? 0) : 0,
      })),
    };
  }

  // ===========================================================================
  // Outbox handlers (email + in-app bell) — idempotent, best-effort bell.
  // ===========================================================================

  /** Acknowledge a freshly filed complaint to the complainant. */
  async sendGrievanceFiledEmail(grievanceId: string): Promise<void> {
    await this.sendGrievanceEmail(grievanceId, {
      templateKey: 'grievance_filed',
      notifType: 'grievance_filed',
      title: 'Complaint received',
      body: (g) =>
        `We've received your complaint ${g.ticketNumber} ("${g.subject}") and it is being reviewed by our grievance team.`,
    });
  }

  /** Notify the complainant of a status change (in-progress/escalated/resolved/closed). */
  async sendGrievanceStatusEmail(
    grievanceId: string,
    status: GrievanceStatus,
    occurrence?: string,
  ): Promise<void> {
    await this.sendGrievanceEmail(grievanceId, {
      templateKey: 'grievance_status',
      notifType: `grievance_status_${status.toLowerCase()}`,
      // Occurrence-scoped so a re-resolution re-notifies (review #4); falls back
      // to the bare status for any legacy event enqueued without an occurrence.
      dedupeSuffix: occurrence ? `${status}:${occurrence}` : status,
      title: this.statusTitle(status),
      body: (g) => this.statusBody(g, status),
    });
  }

  /** Notify the complainant that the officer replied on their thread. */
  async sendGrievanceReplyEmail(
    grievanceId: string,
    messageId: string,
  ): Promise<void> {
    const message = await this.prisma.grievanceMessage.findUnique({
      where: { id: messageId },
    });
    if (!message || message.internal) return; // never surface an internal note
    await this.sendGrievanceEmail(grievanceId, {
      templateKey: 'grievance_reply',
      notifType: 'grievance_reply',
      dedupeSuffix: messageId,
      title: 'New response to your complaint',
      body: (g) =>
        `Our grievance team responded to your complaint ${g.ticketNumber}: ${message.body}`,
    });
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async sendGrievanceEmail(
    grievanceId: string,
    opts: {
      templateKey: string;
      notifType: string;
      title: string;
      body: (g: GrievanceRow) => string;
      dedupeSuffix?: string;
    },
  ): Promise<void> {
    const g = await this.prisma.grievance.findUnique({
      where: { id: grievanceId },
    });
    if (!g) return;
    const body = opts.body(g);
    const link = `/account/grievances/${g.id}`;
    const dedupe = opts.dedupeSuffix
      ? `${opts.notifType}:${g.id}:${opts.dedupeSuffix}`
      : `${opts.notifType}:${g.id}`;

    // In-app bell first (idempotent) — only when there's a linked user account.
    if (g.raisedByUserId) {
      await this.notifications?.create({
        userId: g.raisedByUserId,
        type: opts.notifType,
        title: opts.title,
        body,
        data: { grievanceId: g.id, ticketNumber: g.ticketNumber, link },
        dedupeKey: `notif:${dedupe}`,
      });
    }

    // Resolve the recipient address: explicit contactEmail wins, else the
    // linked user's account email.
    const to = await this.resolveRecipientEmail(g.raisedByUserId, g.contactEmail);
    if (!to) return;

    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? '';
    const result = await this.email.send(opts.templateKey, to, {
      ticketNumber: g.ticketNumber,
      subject: g.subject,
      message: body,
      grievanceLink: `${frontendUrl}${link}`,
    });
    if (!result.sent && !result.skipped) {
      throw new Error(`${opts.templateKey} email failed: ${result.message}`);
    }
  }

  private async resolveRecipientEmail(
    raisedByUserId: string | null,
    contactEmail: string | null,
  ): Promise<string | null> {
    // Prefer the AUTHENTICATED account's (verified) email over the free-form,
    // unverified contactEmail (review #5). Otherwise a logged-in user could
    // redirect branded grievance mail — with an attacker-chosen subject — to any
    // address they type, phishing/email-bombing under the platform's sender
    // reputation. contactEmail is only a fallback for a guest complaint that has
    // no linked account.
    if (raisedByUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: raisedByUserId },
        select: { email: true },
      });
      if (user?.email) return user.email;
    }
    return contactEmail ?? null;
  }

  private statusTitle(status: GrievanceStatus): string {
    switch (status) {
      case GrievanceStatus.IN_PROGRESS:
        return 'Your complaint is being worked on';
      case GrievanceStatus.ESCALATED:
        return 'Your complaint has been escalated';
      case GrievanceStatus.RESOLVED:
        return 'Your complaint has been resolved';
      case GrievanceStatus.CLOSED:
        return 'Your complaint has been closed';
      default:
        return 'Complaint update';
    }
  }

  private statusBody(g: GrievanceRow, status: GrievanceStatus): string {
    switch (status) {
      case GrievanceStatus.IN_PROGRESS:
        return `Your complaint ${g.ticketNumber} is now being handled by our grievance team.`;
      case GrievanceStatus.ESCALATED:
        return `Your complaint ${g.ticketNumber} has been escalated for priority attention.`;
      case GrievanceStatus.RESOLVED:
        return `Your complaint ${g.ticketNumber} has been resolved.${
          g.resolutionNote ? ` Resolution: ${g.resolutionNote}` : ''
        }`;
      case GrievanceStatus.CLOSED:
        return `Your complaint ${g.ticketNumber} has been closed. Thank you for your patience.`;
      default:
        return `There is an update on your complaint ${g.ticketNumber}.`;
    }
  }

  /**
   * Enqueue the customer status-change email. The dedupeKey carries a per-
   * transition OCCURRENCE token (review #4) so a legitimate re-entry into a
   * status — e.g. RESOLVED again after a customer re-open — notifies once more,
   * while at-least-once redeliveries of the SAME event (which carry the same
   * occurrence in the payload) stay deduped.
   */
  private async enqueueStatus(
    tx: Prisma.TransactionClient,
    grievanceId: string,
    status: GrievanceStatus,
  ): Promise<void> {
    const occurrence = new Date().toISOString();
    await this.outbox.enqueue(tx, {
      type: GRIEVANCE_OUTBOX_EVENT.STATUS,
      queue: OUTBOX_QUEUE.EMAILS,
      payload: { grievanceId, status, occurrence },
      dedupeKey: `grievance-status:${grievanceId}:${status}:${occurrence}`,
    });
  }

  private async writeMessage(
    tx: Prisma.TransactionClient,
    grievanceId: string,
    msg: {
      authorUserId?: string;
      authorRole: GrievanceAuthorRole;
      body: string;
      internal?: boolean;
    },
  ): Promise<{ id: string }> {
    return tx.grievanceMessage.create({
      data: {
        grievanceId,
        authorUserId: msg.authorUserId ?? null,
        authorRole: msg.authorRole,
        body: msg.body,
        internal: msg.internal ?? false,
      },
      select: { id: true },
    });
  }

  private assertTransition(from: GrievanceStatus, to: GrievanceStatus): void {
    if (!isValidGrievanceTransition(from, to)) {
      throw new BadRequestException(
        `A complaint cannot move from ${from} to ${to}.`,
      );
    }
  }

  private async requireGrievance(id: string) {
    const g = await this.prisma.grievance.findUnique({ where: { id } });
    if (!g) throw new NotFoundException('Complaint not found.');
    return g;
  }

  private grievanceOfficerFromConfig(): {
    name?: string;
    email?: string;
    phone?: string;
  } | null {
    const name = this.config.get<string>('GRIEVANCE_OFFICER_NAME');
    const email = this.config.get<string>('GRIEVANCE_OFFICER_EMAIL');
    const phone = this.config.get<string>('GRIEVANCE_OFFICER_PHONE');
    if (!name && !email) return null;
    return { name, email, phone };
  }

  /** Coerce a Prisma Grievance row (± messages) to the GraphQL entity shape. */
  private mapGrievance(
    g: GrievanceRow & { messages?: GrievanceMessageRow[] },
    opts: { includeInternal?: boolean; now?: Date } = {},
  ): GrievanceEntity {
    const now = opts.now ?? new Date();
    const slaBreached =
      (g.status === GrievanceStatus.OPEN ||
        g.status === GrievanceStatus.IN_PROGRESS) &&
      g.slaDueAt.getTime() < now.getTime();

    const messages: GrievanceMessageEntity[] | undefined = g.messages
      ? g.messages
          .filter((m) => (opts.includeInternal ? true : !m.internal))
          .map((m) => ({
            id: m.id,
            authorRole: m.authorRole,
            authorUserId: m.authorUserId,
            body: m.body,
            internal: m.internal,
            createdAt: m.createdAt,
          }))
      : undefined;

    return {
      id: g.id,
      ticketNumber: g.ticketNumber,
      raisedByUserId: g.raisedByUserId,
      contactName: g.contactName,
      contactEmail: g.contactEmail,
      orderId: g.orderId,
      sellerOrderId: g.sellerOrderId,
      category: g.category,
      subject: g.subject,
      description: g.description,
      status: g.status,
      priority: g.priority,
      slaDueAt: g.slaDueAt,
      slaBreached,
      assignedToUserId: g.assignedToUserId,
      resolutionNote: g.resolutionNote,
      firstResponseAt: g.firstResponseAt,
      escalatedAt: g.escalatedAt,
      resolvedAt: g.resolvedAt,
      closedAt: g.closedAt,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      messages,
    };
  }
}
