import { OrderStatus } from '@prisma/client';

/**
 * Order-related helpers — kept in their own module so onboarding devs
 * can read them without diving into the placement service.
 */

/**
 * Generate a human-readable order number.
 *
 *   ORD-2026-05-3K7F2P9   ← parent Order
 *   SORD-2026-05-3K7F2P9  ← seller sub-order (same suffix as parent)
 *
 * Format: PREFIX-YYYY-MM-RND7
 *   - YYYY-MM scopes for human readability and partition friendliness
 *   - 7 base32 chars (~30 bits) — collision-resistant enough for our
 *     scale + we have a unique index that backstops accidents.
 */
export function generateOrderNumber(prefix: 'ORD' | 'SORD' = 'ORD'): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const rnd = randomBase32(7);
  return `${prefix}-${yyyy}-${mm}-${rnd}`;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // skip easily-confused chars
function randomBase32(len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Status workflow for a SellerOrder.
 *
 *   PENDING → CONFIRMED → PACKED → SHIPPED → DELIVERED
 *   PENDING → CANCELLED
 *   CONFIRMED → CANCELLED   (seller can still cancel before packing)
 *   DELIVERED → REFUNDED    (returns flow — wired later)
 *
 * No backward transitions — once shipped, you can't un-ship; refunds go
 * through a separate state. Customer-driven cancel only allowed from
 * PENDING (enforced in OrderService.cancelMyOrder).
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  CONFIRMED: [OrderStatus.PACKED, OrderStatus.CANCELLED],
  PACKED: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  SHIPPED: [OrderStatus.DELIVERED],
  DELIVERED: [OrderStatus.REFUNDED],
  CANCELLED: [],
  REFUNDED: [],
};

export function isValidTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Compute the rolled-up parent Order status from its sub-orders. The
 * parent represents "the earliest stage the customer's overall order is
 * still at". Cancelled-only orders read as CANCELLED. Mixed states read
 * as the lowest-progress one (e.g., one PENDING + one DELIVERED → PENDING).
 */
const ORDER_PROGRESS: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

export function computeParentStatus(
  subStatuses: OrderStatus[],
): OrderStatus {
  if (subStatuses.length === 0) return OrderStatus.PENDING;
  // Filter out terminal sub-orders if there's a non-terminal one.
  const live = subStatuses.filter(
    (s) => s !== OrderStatus.CANCELLED && s !== OrderStatus.REFUNDED,
  );
  if (live.length === 0) {
    // All terminal — pick CANCELLED if any cancelled, else REFUNDED.
    return subStatuses.includes(OrderStatus.CANCELLED)
      ? OrderStatus.CANCELLED
      : OrderStatus.REFUNDED;
  }
  let earliest = ORDER_PROGRESS.length - 1;
  for (const s of live) {
    const idx = ORDER_PROGRESS.indexOf(s);
    if (idx >= 0 && idx < earliest) earliest = idx;
  }
  return ORDER_PROGRESS[earliest];
}
