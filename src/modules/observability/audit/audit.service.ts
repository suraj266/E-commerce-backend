/**
 * AuditService — the writer for the append-only security audit trail (P3-05).
 *
 * `record()` is BEST-EFFORT by contract: it wraps the whole write in try/catch
 * and NEVER rethrows. Auditing is an observability side effect, so a failure to
 * record it must never roll back or fail the business transaction it describes.
 * Callers therefore invoke it OUTSIDE their money-moving assertions/transaction
 * (after the state has committed), passing before/after snapshots.
 *
 * The audit table is append-only at the DB (a trigger rejects UPDATE/DELETE —
 * see the migration), so `record()` only ever INSERTs.
 *
 * requestId is pulled from getCorrelationId() so the row lines up with the
 * originating request's logs + Sentry events.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { getCorrelationId } from '@/common/context/request-context';

export interface AuditRecordInput {
  /** Dot-namespaced verb, e.g. `refund.approve`, `payout.mark_paid`. */
  action: string;
  /** Domain entity kind, e.g. `Refund`, `Payout`, `PaymentGatewayConfig`. */
  entityType: string;
  /** Affected entity id, when the action targets a single row. */
  entityId?: string | null;
  /** Acting user's id (null for system/cron/anonymous). */
  actorUserId?: string | null;
  /** Acting user's email captured at action time. */
  actorEmail?: string | null;
  /** State snapshot before the action (redact secrets before passing). */
  before?: unknown;
  /** State snapshot after the action (redact secrets before passing). */
  after?: unknown;
  /** Caller IP (DPDP personal data — see the LEGAL SIGN-OFF note below). */
  ip?: string | null;
  /** Caller User-Agent. */
  userAgent?: string | null;
}

/** Keys whose values are replaced with the redaction token in before/after. */
const SECRET_KEY =
  /(secret|password|passwd|token|apikey|api_key|privatekey|private_key|credential|signature|salt|webhook_?secret|client_?secret|access_?key)/i;
const REDACTED = '***';

/**
 * Deep-clone `value`, replacing any property whose KEY looks secret-bearing
 * with "***". Used to scrub gateway credentials out of audit snapshots. Falls
 * back to the redaction token if the value isn't JSON-serialisable.
 */
export function redactSecrets(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v));
  if (typeof value === 'object') {
    // Preserve Decimal/Date etc. as their serialised form rather than walking
    // their internals.
    if (
      value instanceof Date ||
      value instanceof Prisma.Decimal ||
      typeof (value as { toJSON?: unknown }).toJSON === 'function'
    ) {
      return value;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/**
 * Normalise an arbitrary snapshot into a Prisma JSON input. `undefined` leaves
 * the column unset; `null` writes JSON null; everything else round-trips
 * through JSON so Decimals/Dates become strings and the write can't fail on a
 * non-serialisable value.
 */
function toJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return Prisma.JsonNull;
  }
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append one audit row. Best-effort: any failure is logged + reported to
   * Sentry and swallowed — this method NEVER throws into the caller's flow.
   */
  async record(input: AuditRecordInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          actorUserId: input.actorUserId ?? null,
          actorEmail: input.actorEmail ?? null,
          before: toJson(input.before),
          after: toJson(input.after),
          // LEGAL SIGN-OFF (P3-05): `ip` is stored in full here. It is DPDP
          // personal data — legal must confirm whether it must be TRUNCATED
          // (e.g. last octet zeroed) before storage and the audit-log RETENTION
          // PERIOD. If truncation is required, apply it at this single choke
          // point.
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          requestId: getCorrelationId() ?? null,
        },
      });
    } catch (err) {
      // Never rethrow — auditing must not fail the business action.
      this.logger.error(
        `Audit record failed for ${input.action} on ${input.entityType}${
          input.entityId ? ` ${input.entityId}` : ''
        }: ${(err as Error).message}`,
      );
      Sentry.captureException(err, {
        tags: { subsystem: 'audit', action: input.action },
      });
    }
  }

  /**
   * Paginated, filtered read of the trail (newest first) for the admin viewer.
   * `before`/`after` are serialised to JSON strings for the GraphQL entity.
   */
  async list(filter: AuditListFilter): Promise<AuditListResult> {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));

    const createdAt: Prisma.DateTimeFilter = {};
    if (filter.from) createdAt.gte = filter.from;
    if (filter.to) createdAt.lt = filter.to;

    const where: Prisma.AuditLogWhereInput = {
      ...(filter.actorUserId ? { actorUserId: filter.actorUserId } : {}),
      ...(filter.entityType ? { entityType: filter.entityType } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.from || filter.to ? { createdAt } : {}),
    };

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actorUserId,
        actorEmail: r.actorEmail,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before == null ? null : JSON.stringify(r.before),
        after: r.after == null ? null : JSON.stringify(r.after),
        ip: r.ip,
        userAgent: r.userAgent,
        requestId: r.requestId,
        createdAt: r.createdAt,
      })),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }
}

export interface AuditListFilter {
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
}

export interface AuditListRow {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: string | null;
  after: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

export interface AuditListResult {
  items: AuditListRow[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}
