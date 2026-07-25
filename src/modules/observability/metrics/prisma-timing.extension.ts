/**
 * P3-04 — Prisma query-duration timing as a Prisma-5 `$extends` query
 * extension.
 *
 * This is COMPOSED into the same extension chain as P3-10's soft-delete filter
 * inside PrismaService (Prisma supports chaining multiple `$extends`). It is a
 * transparent wrapper: it observes wall-clock duration around the real query
 * and returns the result untouched — it NEVER changes args, results, or
 * soft-delete semantics. It is applied INNERMOST (before the soft-delete
 * extension) so the histogram measures the actual DB round-trip, and the
 * un-extended base client used by soft-delete's delete→update re-dispatch is
 * unaffected (and simply not timed).
 *
 * Only model operations (findMany/create/update/…) flow through
 * `$allModels.$allOperations`; client-level calls like `$queryRaw` /
 * `$transaction` pass straight through untimed, which is intentional.
 */

import { Prisma } from '@prisma/client';
import { prismaQueryDuration } from './metrics.registry';

export function createPrismaTimingExtension() {
  return Prisma.defineExtension({
    name: 'query-timing',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const stopTimer = prismaQueryDuration.startTimer({
            model: model ?? 'unknown',
            operation,
          });
          try {
            return await query(args);
          } finally {
            // Records elapsed seconds against {model, operation}. Runs on both
            // the success and error paths so slow failures are still measured.
            stopTimer();
          }
        },
      },
    },
  });
}
