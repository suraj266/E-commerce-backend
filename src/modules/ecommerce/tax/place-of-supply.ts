/**
 * Place of supply + GST split utilities.
 *
 * "Place of supply" (PoS) is the GST law concept that determines which
 * tax applies to a transaction:
 *
 *   - If seller state == buyer state (intra-state):    CGST + SGST
 *   - If seller state != buyer state (inter-state):    IGST
 *
 * UTGST (Union Territory GST) substitutes SGST when both supplier and
 * recipient are in the same UT without legislature. For Phase 1 we model
 * UTGST as a Phase 2 refinement and treat all intra-state as CGST + SGST;
 * the document trail still uses the right state code so a follow-up
 * migration can re-bucket later.
 *
 * All amount math is done at 4 decimal places internally — display layers
 * round to 2 dp. This is the standard pattern for GST: the per-line GST
 * components individually may have fractional paise, but the SUM at
 * invoice level is rounded so the customer's payable amount is whole rupees.
 */

export type TaxKind = 'INTRA_STATE' | 'INTER_STATE';

export interface TaxBreakup {
  /** Pre-tax taxable value (post-discount). */
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  cessRate: number;
  cessAmount: number;
  /** cgst + sgst + igst + cess. */
  totalTax: number;
  /** taxableValue + totalTax. */
  totalWithTax: number;
}

/**
 * Determines whether a transaction is intra-state or inter-state given
 * the supplier's and recipient's GST state codes.
 *
 * Both codes must be valid 2-digit GST state codes (see gst-states.ts).
 * Throws if either is missing — callers must surface a clear user-facing
 * error rather than silently apply the wrong tax.
 */
export function getTaxKind(
  sellerStateCode: string | null | undefined,
  buyerStateCode: string | null | undefined,
): TaxKind {
  if (!sellerStateCode) {
    throw new Error('Cannot determine place of supply: seller state code is missing');
  }
  if (!buyerStateCode) {
    throw new Error('Cannot determine place of supply: buyer state code is missing');
  }
  return sellerStateCode === buyerStateCode ? 'INTRA_STATE' : 'INTER_STATE';
}

/**
 * Computes the per-line tax breakup.
 *
 * @param taxableValue - The amount on which GST is computed (post-discount,
 *                       exclusive of tax). For tax-inclusive catalog prices
 *                       the caller back-calculates this via `fromInclusiveMrp`.
 * @param totalRate    - The product's GST rate (e.g. 18 for 18%).
 * @param taxKind      - From getTaxKind().
 * @param cessRate     - Optional GST compensation cess (e.g. 22% on tobacco).
 *                       Default 0.
 */
export function splitTax(
  taxableValue: number,
  totalRate: number,
  taxKind: TaxKind,
  cessRate = 0,
): TaxBreakup {
  if (!Number.isFinite(taxableValue) || taxableValue < 0) {
    throw new Error(`taxableValue must be a non-negative number, got ${taxableValue}`);
  }
  if (!Number.isFinite(totalRate) || totalRate < 0) {
    throw new Error(`totalRate must be a non-negative number, got ${totalRate}`);
  }
  if (!Number.isFinite(cessRate) || cessRate < 0) {
    throw new Error(`cessRate must be a non-negative number, got ${cessRate}`);
  }

  const cessAmount = round4((taxableValue * cessRate) / 100);

  if (taxKind === 'INTRA_STATE') {
    // CGST and SGST share the rate equally. We compute each half independently
    // (rather than half-of-total) so rounding lands the same on each side.
    const halfRate = round4(totalRate / 2);
    const cgstAmount = round4((taxableValue * halfRate) / 100);
    const sgstAmount = round4((taxableValue * halfRate) / 100);
    const totalTax = round4(cgstAmount + sgstAmount + cessAmount);
    return {
      taxableValue: round4(taxableValue),
      cgstRate: halfRate,
      cgstAmount,
      sgstRate: halfRate,
      sgstAmount,
      igstRate: 0,
      igstAmount: 0,
      cessRate,
      cessAmount,
      totalTax,
      totalWithTax: round4(taxableValue + totalTax),
    };
  }

  // INTER_STATE → full rate as IGST
  const igstAmount = round4((taxableValue * totalRate) / 100);
  const totalTax = round4(igstAmount + cessAmount);
  return {
    taxableValue: round4(taxableValue),
    cgstRate: 0,
    cgstAmount: 0,
    sgstRate: 0,
    sgstAmount: 0,
    igstRate: totalRate,
    igstAmount,
    cessRate,
    cessAmount,
    totalTax,
    totalWithTax: round4(taxableValue + totalTax),
  };
}

/**
 * Back-calculates pre-tax taxable value from a tax-inclusive MRP.
 *
 *   taxableValue = mrp × 100 / (100 + totalRate + cessRate)
 *
 * Cess (if any) is included in the divisor so the back-calc lands exactly
 * on the customer's quoted price when summed with the resulting taxes.
 *
 * Example: ₹118 MRP with 18% GST → ₹100.0000 taxable + ₹18 GST = ₹118.
 *          ₹140 MRP with 18% GST + 22% cess → ₹100.0000 taxable.
 */
export function fromInclusiveMrp(
  mrp: number,
  totalRate: number,
  cessRate = 0,
): number {
  if (!Number.isFinite(mrp) || mrp < 0) {
    throw new Error(`mrp must be a non-negative number, got ${mrp}`);
  }
  const divisor = 100 + totalRate + cessRate;
  if (divisor <= 0) {
    throw new Error(`Invalid rate combination: totalRate=${totalRate}, cessRate=${cessRate}`);
  }
  return round4((mrp * 100) / divisor);
}

/**
 * Sum of multiple TaxBreakup rows — used to compute SellerOrder-level
 * totals from per-OrderItem breakups.
 *
 * Returns a "synthetic" breakup whose rate fields are the simple average
 * (weighted by taxable value would be more accurate but we keep flat for
 * invoice rendering — the line-level rates are the source of truth).
 */
export function sumBreakups(breakups: readonly TaxBreakup[]): TaxBreakup {
  if (breakups.length === 0) {
    return {
      taxableValue: 0,
      cgstRate: 0, cgstAmount: 0,
      sgstRate: 0, sgstAmount: 0,
      igstRate: 0, igstAmount: 0,
      cessRate: 0, cessAmount: 0,
      totalTax: 0,
      totalWithTax: 0,
    };
  }

  const totals = breakups.reduce(
    (acc, b) => ({
      taxableValue: acc.taxableValue + b.taxableValue,
      cgstAmount: acc.cgstAmount + b.cgstAmount,
      sgstAmount: acc.sgstAmount + b.sgstAmount,
      igstAmount: acc.igstAmount + b.igstAmount,
      cessAmount: acc.cessAmount + b.cessAmount,
    }),
    { taxableValue: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, cessAmount: 0 },
  );

  // Pick representative rates from the first non-zero entry. For invoice
  // rendering we drive rates off the per-line entries, not the aggregate.
  const sample = breakups.find((b) => b.cgstAmount + b.sgstAmount + b.igstAmount > 0) ?? breakups[0];
  const totalTax = round4(
    totals.cgstAmount + totals.sgstAmount + totals.igstAmount + totals.cessAmount,
  );

  return {
    taxableValue: round4(totals.taxableValue),
    cgstRate: sample.cgstRate,
    cgstAmount: round4(totals.cgstAmount),
    sgstRate: sample.sgstRate,
    sgstAmount: round4(totals.sgstAmount),
    igstRate: sample.igstRate,
    igstAmount: round4(totals.igstAmount),
    cessRate: sample.cessRate,
    cessAmount: round4(totals.cessAmount),
    totalTax,
    totalWithTax: round4(totals.taxableValue + totalTax),
  };
}

/**
 * Round to 4 decimal places — used for all intermediate tax math.
 * Display layers re-round to 2 dp.
 */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Round to 2 decimal places — for final display amounts and DB writes to
 * legacy `Decimal(10,2)` columns (taxAmount, totalAmount, etc.).
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
