/**
 * Returns / RMA policy constants (P3-02).
 *
 * EVERY value here is provisional and gates a real money / legal decision.
 * Do NOT treat any of these as final until Finance + Legal have signed them off
 * against the published return policy.
 */

import { ReturnStatus } from '@prisma/client';

/**
 * Days after DELIVERY within which a customer may open a return.
 * // NEEDS FINANCE/LEGAL SIGN-OFF — the default window + any per-category
 *    overrides (electronics 7d vs apparel 14d, etc.) + non-returnable categories.
 */
export const RETURN_WINDOW_DAYS = 7;

/**
 * Whether the original outbound shipping charge is included in the return
 * refund. Default false = merchandise value only (industry-standard for a
 * change-of-mind return). A defect/wrong-item return may warrant full shipping
 * refund — that policy branch is not automated in v1.
 * // NEEDS FINANCE SIGN-OFF — proportional shipping-refund rule.
 */
export const RETURN_REFUND_INCLUDE_SHIPPING = false;

/**
 * Whether a customer may choose resolutionType=REPLACEMENT on a return.
 *
 * The REPLACEMENT pipeline is now FULLY BUILT (QC_PASSED → REPLACEMENT_APPROVED
 * → REPLACEMENT_SHIPPED; NEVER touches the refund/clawback/TCS path), but the
 * default stays OFF until Product signs off on the reshipment SLA + inventory
 * treatment. The flag is runtime-SETTABLE via the RETURNS_ALLOW_REPLACEMENT env
 * var ('true' enables it) so ops can flip it without a redeploy — read through
 * `replacementEnabled()` at call time, never the frozen boolean below.
 * // NEEDS PRODUCT SIGN-OFF — enable only when replacement fulfilment ships.
 */
export const RETURNS_ALLOW_REPLACEMENT = false;

/**
 * Runtime gate for the REPLACEMENT resolution. Reads the env override at
 * call-time (so a test / ops toggle takes effect without re-importing) and
 * falls back to the compiled default above.
 */
export function replacementEnabled(): boolean {
  const env = process.env.RETURNS_ALLOW_REPLACEMENT;
  if (env === 'true') return true;
  if (env === 'false') return false;
  return RETURNS_ALLOW_REPLACEMENT;
}

/**
 * How the commission clawback magnitude is derived when a return is refunded
 * against an already-settled seller order. 'SELLER_PAYOUT_AMOUNT' recovers the
 * net the seller was actually paid for the returned slice.
 * // NEEDS FINANCE SIGN-OFF — basis (full payout vs commission-only) + rounding.
 */
export const RETURN_CLAWBACK_BASIS = 'SELLER_PAYOUT_AMOUNT' as const;

/**
 * Legal ReturnStatus transitions. A move not listed here is rejected by the
 * service (defence in depth alongside the conditional status flip).
 */
export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  REQUESTED: [ReturnStatus.APPROVED, ReturnStatus.REJECTED],
  APPROVED: [ReturnStatus.PICKUP_SCHEDULED, ReturnStatus.REJECTED],
  PICKUP_SCHEDULED: [ReturnStatus.IN_TRANSIT, ReturnStatus.RECEIVED],
  IN_TRANSIT: [ReturnStatus.RECEIVED],
  RECEIVED: [ReturnStatus.QC_PASSED, ReturnStatus.QC_FAILED],
  // QC_PASSED forks on resolutionType: a REFUND return goes to REFUNDED (money
  // fan-out); a REPLACEMENT return goes to REPLACEMENT_APPROVED (NO refund).
  QC_PASSED: [ReturnStatus.REFUNDED, ReturnStatus.REPLACEMENT_APPROVED],
  QC_FAILED: [ReturnStatus.REJECTED, ReturnStatus.CLOSED],
  REFUNDED: [ReturnStatus.CLOSED],
  // Replacement arm: seller ships the swap unit, then the return closes.
  REPLACEMENT_APPROVED: [ReturnStatus.REPLACEMENT_SHIPPED],
  REPLACEMENT_SHIPPED: [ReturnStatus.CLOSED],
  CLOSED: [],
  REJECTED: [],
};

export function isValidReturnTransition(
  from: ReturnStatus,
  to: ReturnStatus,
): boolean {
  return RETURN_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Outbox event types owned by the RETURN surface for the REPLACEMENT arm.
 *
 * These are declared HERE (not in outbox.constants.ts) because that file is
 * owned by the newsletter agent this wave — the orchestrator merges these two
 * literals into OUTBOX_EVENT + adds the matching EmailsProcessor cases (see the
 * CENTRAL-WIRING report). The string VALUES are the contract; the enqueue uses
 * these constants and the processor switches on the same literals.
 *
 * // CENTRAL-WIRING (outbox): add to OUTBOX_EVENT and route on the EMAILS queue:
 *   EMAIL_RETURN_REPLACEMENT_APPROVED: 'email.return_replacement_approved'
 *     → ReturnsService.sendReturnReplacementApprovedEmail(payload.returnId)
 *   EMAIL_RETURN_REPLACEMENT_SHIPPED:  'email.return_replacement_shipped'
 *     → ReturnsService.sendReturnReplacementShippedEmail(payload.returnId)
 */
export const RETURN_OUTBOX_EVENT = {
  REPLACEMENT_APPROVED: 'email.return_replacement_approved',
  REPLACEMENT_SHIPPED: 'email.return_replacement_shipped',
} as const;
