/**
 * Shipping-rate engine — pure, zero-dependency (mirrors place-of-supply.ts).
 *
 * The SAME function powers two surfaces so a quote always equals what the
 * customer is charged at placement:
 *   - the `shippingQuote` preview (cart / checkout), and
 *   - `order-placement.service.ts` when it writes SellerOrder.shippingAmount.
 *
 * Rate model (per store): FLAT + FREE-OVER-THRESHOLD + PER-KG.
 *   charge = (subtotal >= freeAbove) ? 0 : flatRate + perKgRate × billableWeight
 *
 * The configured charge is treated as TAX-INCLUSIVE (the customer pays exactly
 * this number; GST is computed back out of it at the principal item's rate via
 * the composite-supply rule — see order-placement.service.ts). This file only
 * computes the charge; GST is layered on by the caller using the tax helpers.
 *
 * No Prisma / Nest imports here — keep it trivially unit-testable and reusable
 * inside the placement transaction.
 */

/** Fallback per-unit weight (kg) when neither variant nor product sets one. */
export const DEFAULT_ITEM_WEIGHT_KG = 0.5;

/**
 * Per-store shipping configuration. Persisted as `Store.shippingConfig` (Json).
 * `flatRate` is the only effectively-required field; everything else is optional
 * with the safe defaults applied by `parseShippingConfig`.
 */
export interface ShippingConfig {
  /** Order subtotal at/above which shipping is free. Null/undefined = never free. */
  freeAbove?: number | null;
  /** Base shipping charge (₹) when not free. Missing → 0 (store ships free). */
  flatRate: number;
  /** Additional ₹ per billable kg, added to flatRate. */
  perKgRate?: number | null;
  /** Whether Cash on Delivery is offered by this store. */
  codEnabled?: boolean;
  /** Max order value (₹) eligible for COD. Null = no limit. */
  codLimit?: number | null;
  /** Reserved for v1.1 — a flat COD handling fee. NOT charged in v1. */
  codFee?: number | null;
  /** Informational dispatch SLA shown to the buyer. */
  processingDays?: number | null;
  /** Origin pincode (for future zone/courier logic). */
  originPincode?: string | null;
  /** Pincodes this store does NOT deliver to. Empty = serviceable PAN-India. */
  excludedPincodes?: string[];
}

export interface ShippingRateItem {
  /** Per-unit weight in kg (variant ?? product ?? null). */
  weight: number | null;
  qty: number;
}

export interface ShippingResult {
  /** Customer-facing charge, tax-inclusive, rounded to paise. */
  shippingCharge: number;
  /** True when the free-over-threshold kicked in. */
  freeApplied: boolean;
  /** Total billable weight (kg), rounded up to 2dp. */
  billableWeightKg: number;
  breakdown: {
    base: number;
    weightComponent: number;
    freeThreshold: number | null;
  };
}

/** Indian PIN code: 6 digits, not starting with 0. */
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

/**
 * Coerce the raw `Store.shippingConfig` Json into a typed, safe-defaulted shape.
 * Used identically by the quote service and the placement transaction so both
 * interpret a store's config the same way.
 */
export function parseShippingConfig(raw: unknown): ShippingConfig {
  const c = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    freeAbove: num(c.freeAbove),
    flatRate: num(c.flatRate) ?? 0,
    perKgRate: num(c.perKgRate),
    codEnabled: c.codEnabled === true,
    codLimit: num(c.codLimit),
    codFee: num(c.codFee),
    processingDays: num(c.processingDays),
    originPincode: typeof c.originPincode === 'string' ? c.originPincode : null,
    excludedPincodes: Array.isArray(c.excludedPincodes)
      ? c.excludedPincodes.filter((p): p is string => typeof p === 'string')
      : [],
  };
}

/**
 * Compute the shipping charge for one seller's items.
 *
 * @param merchandiseSubtotal - customer-facing goods subtotal used for the
 *        free-shipping threshold. Caller decides pre- vs post-discount (we use
 *        pre-discount `so.subtotal` so a coupon can't silently revoke free
 *        shipping) — but it MUST be the same choice in preview and placement.
 */
export function computeSellerShipping(params: {
  items: readonly ShippingRateItem[];
  merchandiseSubtotal: number;
  config: ShippingConfig;
}): ShippingResult {
  const { items, merchandiseSubtotal, config } = params;

  // Total weight — coerce missing/garbage per-unit weights to the default.
  const totalWeight = items.reduce((sum, it) => {
    const w = Number.isFinite(it.weight as number) && (it.weight as number) > 0
      ? (it.weight as number)
      : DEFAULT_ITEM_WEIGHT_KG;
    const qty = Number.isFinite(it.qty) && it.qty > 0 ? it.qty : 0;
    return sum + w * qty;
  }, 0);
  // Couriers bill rounded-up slabs — ceil so we never under-charge.
  const billableWeightKg = Math.ceil(totalWeight * 100) / 100;

  const freeThreshold = config.freeAbove ?? null;
  if (freeThreshold != null && merchandiseSubtotal >= freeThreshold) {
    return {
      shippingCharge: 0,
      freeApplied: true,
      billableWeightKg,
      breakdown: { base: 0, weightComponent: 0, freeThreshold },
    };
  }

  const base = round2(config.flatRate ?? 0);
  const weightComponent = round2((config.perKgRate ?? 0) * billableWeightKg);
  const shippingCharge = round2(base + weightComponent);

  return {
    shippingCharge,
    freeApplied: false,
    billableWeightKg,
    breakdown: { base, weightComponent, freeThreshold },
  };
}

/** COD allowed when enabled and the cash-collected total is within the limit. */
export function isCodEligible(config: ShippingConfig, sellerGrandTotal: number): boolean {
  if (!config.codEnabled) return false;
  if (config.codLimit == null) return true;
  return sellerGrandTotal <= config.codLimit;
}

/** Indian PIN format check. */
export function isValidPincode(pincode: string | null | undefined): boolean {
  return typeof pincode === 'string' && PINCODE_REGEX.test(pincode.trim());
}

/**
 * Serviceability (v1, no courier API): a valid pincode is serviceable unless the
 * store explicitly excludes it. Zone/courier coverage is Phase B.
 */
export function isServiceable(config: ShippingConfig, pincode: string | null | undefined): boolean {
  if (!isValidPincode(pincode)) return false;
  const pin = (pincode as string).trim();
  return !(config.excludedPincodes ?? []).includes(pin);
}

/** Round to 2 decimal places (paise) — matches place-of-supply.round2. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
