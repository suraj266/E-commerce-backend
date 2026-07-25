import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from '@/common/config/config';
import { createPrismaTimingExtension } from '@/modules/observability/metrics/prisma-timing.extension';

/**
 * P3-10 — Centralized soft-delete filtering behind a Prisma-5 `$extends` query
 * extension, behind a kill-switch (`SOFT_DELETE_EXTENSION_ENABLED`) that
 * DEFAULTS OFF.
 *
 * ─── Why a kill-switch that defaults OFF ────────────────────────────────────
 * Soft-delete is currently hand-filtered (`where: { deletedAt: null }`) across
 * ~52 files. This extension centralizes that, but flipping the behavior of the
 * ONE client every service shares is high-blast-radius, so it ships DARK: with
 * the flag off, `PrismaService` is a plain `PrismaClient` — no extension is
 * built, no Proxy is installed, and every property access resolves straight to
 * the base delegate. Runtime behavior is byte-for-byte identical to before this
 * change (see the early `return` in the constructor). The existing manual
 * filters are intentionally KEPT this wave (belt-and-suspenders); they become
 * redundant no-ops when the flag is on and are retired in later reviewed
 * batches — they are NOT removed here.
 *
 * ─── What the extension does (flag ON) ──────────────────────────────────────
 * For every model that physically has a `deletedAt` column (discovered from the
 * DMMF — data-driven, no hard-coded list):
 *   • find/findFirst/findFirstOrThrow/findMany/count/aggregate/groupBy — injects
 *     `deletedAt: null` into `where` (unless the caller already scoped
 *     `deletedAt`, which is respected — so existing manual filters keep working
 *     and an explicit "show deleted" query is never clobbered).
 *   • findUnique/findUniqueOrThrow — `where` is a UNIQUE-only input that cannot
 *     take `deletedAt`, so we run the real lookup and drop the row if it turns
 *     out to be soft-deleted (findUnique → null, findUniqueOrThrow → P2025).
 *   • delete   → update  ({ data: { deletedAt: now } })
 *   • deleteMany → updateMany({ data: { deletedAt: now } }) over live rows only.
 *
 * ─── Documented limitations (explicit filters stay for these) ───────────────
 *   • NESTED RELATION READS ARE NOT SCOPED. `include`/`select` of a relation
 *     pulls soft-deleted children — Prisma query extensions only see the
 *     top-level operation, not nested reads. Keep explicit `where: { deletedAt:
 *     null }` on nested relation filters.
 *   • The delete/deleteMany rewrites re-dispatch through the *base*
 *     (un-extended) client. Inside an interactive `$transaction` that base call
 *     does NOT join the caller's transaction — this mirrors Prisma's own
 *     soft-delete extension guidance. Code that must soft-delete atomically
 *     inside a `$transaction` should keep calling
 *     `tx.<model>.update({ data: { deletedAt } })` explicitly (as it does
 *     today). (Reads — including the findUnique re-check — run via the
 *     transaction-bound `query`, so read filtering IS correct inside a tx.)
 *
 * Admin / audit reads that must SEE soft-deleted rows use `prisma.raw` — the
 * un-extended client — regardless of the flag.
 */

/** The soft-delete tombstone column every soft-deletable model shares. */
const SOFT_DELETE_FIELD = 'deletedAt';

/** Prisma operations whose `where` accepts `deletedAt` and can be filtered inline. */
const FILTERABLE_READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Model names (as they appear in the DMMF / `model` callback arg, e.g.
 * `Product`, `SellerOrder`) that physically carry a `deletedAt` column.
 * Computed once from `Prisma.dmmf` so the set stays in lock-step with the
 * schema — add a `deletedAt` column to a new model and it is covered
 * automatically, with no edit here.
 */
function computeSoftDeleteModels(): ReadonlySet<string> {
  const models = new Set<string>();
  for (const model of Prisma.dmmf.datamodel.models) {
    if (model.fields.some((f) => f.name === SOFT_DELETE_FIELD)) {
      models.add(model.name);
    }
  }
  return models;
}

/** `Product` → `product`, `SellerOrder` → `sellerOrder` (Prisma delegate name). */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Add `deletedAt: null` to a top-level `where`, but ONLY if the caller has not
 * already scoped `deletedAt` themselves. This is what keeps the extension
 * additive: the ubiquitous manual `where: { deletedAt: null }` filters are
 * respected (no-op), and a deliberate `deletedAt: { not: null }` query on the
 * normal client is never silently contradicted.
 */
function withDeletedNull(where: Record<string, unknown> | undefined | null) {
  if (where && Object.prototype.hasOwnProperty.call(where, SOFT_DELETE_FIELD)) {
    return where;
  }
  return { ...(where ?? {}), [SOFT_DELETE_FIELD]: null };
}

/**
 * Builds the soft-delete query extension. `base` is the UN-extended client used
 * to re-dispatch delete→update and the findUnique re-check (re-dispatching on
 * the extended client would recurse through this same filter).
 */
function createSoftDeleteExtension(base: PrismaClient) {
  const softDeleteModels = computeSoftDeleteModels();

  return Prisma.defineExtension({
    name: 'soft-delete',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Models without a `deletedAt` column: untouched passthrough.
          if (!softDeleteModels.has(model)) {
            return query(args);
          }

          const a = (args ?? {}) as Record<string, any>;

          if (FILTERABLE_READ_OPS.has(operation)) {
            return query({ ...a, where: withDeletedNull(a.where) });
          }

          const delegate = (base as any)[delegateName(model)];

          switch (operation) {
            // `where` is a UNIQUE input here and cannot carry `deletedAt`; run
            // the real lookup, then drop the row if it is soft-deleted. We
            // ensure `deletedAt` is readable (forcing it into an explicit
            // `select`, then stripping it back out) so the check is reliable.
            case 'findUnique':
            case 'findUniqueOrThrow': {
              const usesSelect =
                a.select && a.select[SOFT_DELETE_FIELD] === undefined;
              const runArgs = usesSelect
                ? { ...a, select: { ...a.select, [SOFT_DELETE_FIELD]: true } }
                : a;
              const row: any = await query(runArgs);
              if (row && row[SOFT_DELETE_FIELD] != null) {
                if (operation === 'findUniqueOrThrow') {
                  throw new Prisma.PrismaClientKnownRequestError(
                    `No ${model} found`,
                    { code: 'P2025', clientVersion: Prisma.prismaVersion.client },
                  );
                }
                return null;
              }
              if (usesSelect && row) delete row[SOFT_DELETE_FIELD];
              return row;
            }

            // Hard delete → soft delete. Re-dispatched on the base client (see
            // the interactive-transaction caveat in the class doc).
            case 'delete':
              return delegate.update({
                ...a,
                data: { [SOFT_DELETE_FIELD]: new Date() },
              });

            case 'deleteMany':
              return delegate.updateMany({
                ...a,
                where: withDeletedNull(a.where),
                data: { [SOFT_DELETE_FIELD]: new Date() },
              });

            // create/update/upsert/updateMany/…: never auto-filtered — these
            // must be able to touch soft-deleted rows (e.g. the manual
            // `update({ data: { deletedAt } })` restore/delete calls still used
            // everywhere this wave).
            default:
              return query(args);
          }
        },
      },
    },
  });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * The extension-aware client every model delegate is routed through when at
   * least one extension (P3-04 query-timing and/or P3-10 soft-delete) is active.
   * When BOTH flags are off this is simply `this` (no extension), and the
   * constructor returns early WITHOUT installing the routing Proxy.
   */
  private readonly extendedClient: PrismaClient;

  constructor() {
    super();

    // ── P3-04 composition note ──────────────────────────────────────────────
    // Two independent extensions may be chained onto the base client:
    //   • query-timing (P3-04, gated by METRICS_ENABLED, default ON) — a
    //     TRANSPARENT wrapper that only observes a duration histogram; it never
    //     alters args/results/soft-delete semantics.
    //   • soft-delete (P3-10, gated by SOFT_DELETE_EXTENSION_ENABLED, default
    //     OFF) — the semantic `deletedAt: null` filter + delete→update rewrite.
    // Timing is applied INNERMOST (so it measures the real DB round-trip) and
    // soft-delete wraps it. When BOTH flags are off we take the original P3-10
    // fast path: `this` is a bare PrismaClient, no extension, no Proxy — runtime
    // behaviour byte-for-byte identical. The soft-delete kill-switch semantics
    // (raw/rawClient bypass, delete→update via the un-extended base, lifecycle
    // hooks on the base) are preserved EXACTLY in every branch.
    const metricsOn = config.METRICS_ENABLED;
    const softDeleteOn = config.SOFT_DELETE_EXTENSION_ENABLED;

    if (!metricsOn && !softDeleteOn) {
      // ── BOTH FLAGS OFF (default soft-delete state): bare PrismaClient. ──
      // No extension is built, no Proxy is installed. `this.<model>.<op>`
      // resolves to the native delegate — identical to the pre-P3-10 service.
      this.extendedClient = this;
      return;
    }

    // Chain extensions over the base (this). Soft-delete is created against the
    // UN-extended base (`this`) so its delete→update re-dispatch + findUnique
    // re-check never recurse through — and are never mutated by — timing.
    let extended: PrismaClient = this;
    if (metricsOn) {
      extended = extended.$extends(
        createPrismaTimingExtension(),
      ) as unknown as PrismaClient;
    }
    if (softDeleteOn) {
      extended = extended.$extends(
        createSoftDeleteExtension(this),
      ) as unknown as PrismaClient;
    }
    this.extendedClient = extended;

    // Route every delegate / `$`-method access through the extended client via a
    // Proxy, so the ~52 existing injectors of PrismaService transparently pick
    // up timing (and, when enabled, soft-delete filtering) with no call-site
    // changes. `raw`/`rawClient` and the lifecycle hooks stay on the
    // un-extended base.
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Un-extended base client — sees soft-deleted rows (admin/audit reads).
        if (prop === 'raw' || prop === 'rawClient') return target;
        // Lifecycle hooks must run against the base (owns the connection).
        if (prop === 'onModuleInit' || prop === 'onModuleDestroy') {
          return (target as any)[prop].bind(target);
        }
        // Everything else (model delegates, $transaction, $queryRaw, …) goes
        // through the extended client.
        const value = (extended as any)[prop];
        return typeof value === 'function' ? value.bind(extended) : value;
      },
    });
  }

  /**
   * RAW, un-extended Prisma client — bypasses the soft-delete filter so
   * admin/audit views can read (and act on) soft-deleted rows. Returns the base
   * client whether or not the extension flag is on.
   */
  get raw(): PrismaClient {
    return this;
  }

  /** Alias for {@link raw}. */
  get rawClient(): PrismaClient {
    return this;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
