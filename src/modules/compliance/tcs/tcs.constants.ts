/**
 * TCS §52 constants (Phase 3, P3-03).
 *
 * ⚠️  EVERY value in this file is PROVISIONAL and legally load-bearing. Each one
 *     carries a `// NEEDS CA SIGN-OFF` marker. NOTHING here may be treated as
 *     final until a chartered accountant has confirmed it against the live GSTN
 *     utility + the current CGST Act / notifications. This subsystem
 *     COMPUTES / LEDGERS / EXPORTS only — filing stays a manual CA action.
 *
 * Marketplace TCS (CGST §52): an e-commerce OPERATOR collects TCS on the *net
 * value of taxable supplies* made THROUGH it by its sellers, and deposits it to
 * the government by the 10th of the following month (GSTR-8).
 */

/**
 * Total TCS rate in BASIS POINTS (100 bps = 1.00%).
 *
 * Current statutory rate is 1% of net taxable value, split for an intra-state
 * supply into 0.5% CGST-TCS + 0.5% SGST-TCS, and levied as a flat 1% IGST-TCS
 * on an inter-state supply. (The rate was 1% since Oct-2018; a 0.5% notification
 * circulated in 2024 — the CA MUST confirm the rate in force for each period.)
 *
 * // NEEDS CA SIGN-OFF — the 1% total rate.
 */
export const TCS_TOTAL_RATE_BPS = 100;

/**
 * Intra-state half-rate (CGST-TCS and SGST-TCS each), in basis points.
 * 50 + 50 = TCS_TOTAL_RATE_BPS.
 *
 * // NEEDS CA SIGN-OFF — the 0.5% + 0.5% CGST/SGST split.
 */
export const TCS_CGST_RATE_BPS = 50;
export const TCS_SGST_RATE_BPS = 50;

/**
 * Inter-state rate (IGST-TCS), in basis points. Equals TCS_TOTAL_RATE_BPS.
 *
 * // NEEDS CA SIGN-OFF — the 1% IGST-TCS rate.
 */
export const TCS_IGST_RATE_BPS = 100;

/**
 * Whether the shipping charge (a COMPOSITE SUPPLY taxed at the principal item's
 * rate — see the invoice pipeline) is INCLUDED in the TCS base. The law taxes
 * the "net value of taxable supplies"; shipping billed by the seller is part of
 * that consideration, so it is included by default. The CA must confirm.
 *
 * // NEEDS CA SIGN-OFF — the exact "net taxable value" base definition
 *    (does it include seller-billed shipping? seller-billed handling? etc.).
 */
export const TCS_INCLUDE_SHIPPING_IN_BASE = true;

/**
 * HSN-code prefixes that are EXEMPT from TCS (a line whose HSN starts with any
 * of these is excluded from the TCS base). §52 excludes, among others, supplies
 * on which the operator is liable to pay tax under §9(5) and notified
 * exempt/nil-rated goods. EMPTY until the CA enumerates the exact list for this
 * catalogue — an empty list means "nothing is treated as exempt" (conservative:
 * we would over-collect, never under-collect).
 *
 * // NEEDS CA SIGN-OFF — the exempt-category / §9(5) / nil-rated list.
 */
export const TCS_EXEMPT_HSN_PREFIXES: readonly string[] = [];

/**
 * Registration/collection threshold, in RUPEES of net taxable value, below which
 * TCS is not collected. §52 has NO small-supplier threshold — TCS applies from
 * the first rupee — so this is 0. Present only as an explicit, reviewable knob.
 *
 * // NEEDS CA SIGN-OFF — confirm there is no de-minimis threshold.
 */
export const TCS_MIN_TAXABLE_VALUE = 0;

/**
 * Statutory deposit / GSTR-8 filing deadline: the Nth day of the month FOLLOWING
 * the supply month. The reminder cron nudges finance before this date.
 *
 * // NEEDS CA SIGN-OFF — the by-10th deadline (and any extension notifications).
 */
export const TCS_DEPOSIT_DAY_OF_MONTH = 10;

/**
 * Schema-version tags stamped onto the exported JSON so a downstream validator
 * (and the CA) can pin exactly which GSTN schema each export targeted. These are
 * PLACEHOLDERS — they MUST be reconciled against the version the live GSTN
 * offline utility currently accepts before any export is filed.
 *
 * // NEEDS CA SIGN-OFF — the exact GSTR-8 / GSTR-1 schema versions in force.
 */
export const GSTR8_SCHEMA_VERSION = 'GSTR8-vPLACEHOLDER'; // NEEDS CA SIGN-OFF
export const GSTR1_SCHEMA_VERSION = 'GSTR1-vPLACEHOLDER'; // NEEDS CA SIGN-OFF

/**
 * A single banner embedded in every export payload so a downstream consumer can
 * never mistake a provisional computation for a filing-ready return.
 */
export const TCS_EXPORT_DISCLAIMER =
  'PROVISIONAL — computed by the marketplace TCS ledger (P3-03). Every rate, ' +
  'base definition and schema version NEEDS CA SIGN-OFF and must be validated ' +
  'against the live GSTN utility before filing.';
