import { Prisma } from '@prisma/client';

/**
 * True only when a Prisma error is a unique-constraint violation (P2002) on the
 * order idempotency index `@@unique([customerId, idempotencyKey])`.
 *
 * The placement transaction also carries other unique constraints (orderNumber,
 * sellerOrder(orderId,sellerId), couponRedemption.orderId). A blind "catch
 * P2002 → treat as replay" would mis-handle one of those as an idempotent
 * replay, so the caller MUST discriminate on the index target before returning
 * the existing order.
 */
export function isIdempotencyConflict(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  const asStr = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return asStr.includes('idempotencyKey');
}
