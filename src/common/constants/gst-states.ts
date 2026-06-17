/**
 * Indian GST state codes — the canonical list used to determine place of supply.
 *
 * Each entry's `code` is the 2-digit numeric prefix that appears at the start
 * of every GSTIN issued in that state/UT. Same code is printed on tax invoices
 * under "Place of Supply" (CGST Rule 46).
 *
 * Source: https://www.gst.gov.in/ (state-code master, updated when new UTs
 * are constituted — last revised after Jan 2020 J&K/Ladakh split).
 */

export interface GstState {
  /** 2-digit GSTIN prefix. */
  readonly code: string;
  /** Display name. */
  readonly name: string;
  /** True for Union Territories (relevant for UTGST vs SGST). */
  readonly isUT: boolean;
}

export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir', isUT: false },
  { code: '02', name: 'Himachal Pradesh', isUT: false },
  { code: '03', name: 'Punjab', isUT: false },
  { code: '04', name: 'Chandigarh', isUT: true },
  { code: '05', name: 'Uttarakhand', isUT: false },
  { code: '06', name: 'Haryana', isUT: false },
  { code: '07', name: 'Delhi', isUT: true },
  { code: '08', name: 'Rajasthan', isUT: false },
  { code: '09', name: 'Uttar Pradesh', isUT: false },
  { code: '10', name: 'Bihar', isUT: false },
  { code: '11', name: 'Sikkim', isUT: false },
  { code: '12', name: 'Arunachal Pradesh', isUT: false },
  { code: '13', name: 'Nagaland', isUT: false },
  { code: '14', name: 'Manipur', isUT: false },
  { code: '15', name: 'Mizoram', isUT: false },
  { code: '16', name: 'Tripura', isUT: false },
  { code: '17', name: 'Meghalaya', isUT: false },
  { code: '18', name: 'Assam', isUT: false },
  { code: '19', name: 'West Bengal', isUT: false },
  { code: '20', name: 'Jharkhand', isUT: false },
  { code: '21', name: 'Odisha', isUT: false },
  { code: '22', name: 'Chhattisgarh', isUT: false },
  { code: '23', name: 'Madhya Pradesh', isUT: false },
  { code: '24', name: 'Gujarat', isUT: false },
  { code: '25', name: 'Daman and Diu', isUT: true },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', isUT: true },
  { code: '27', name: 'Maharashtra', isUT: false },
  { code: '28', name: 'Andhra Pradesh (Old)', isUT: false },
  { code: '29', name: 'Karnataka', isUT: false },
  { code: '30', name: 'Goa', isUT: false },
  { code: '31', name: 'Lakshadweep', isUT: true },
  { code: '32', name: 'Kerala', isUT: false },
  { code: '33', name: 'Tamil Nadu', isUT: false },
  { code: '34', name: 'Puducherry', isUT: true },
  { code: '35', name: 'Andaman and Nicobar Islands', isUT: true },
  { code: '36', name: 'Telangana', isUT: false },
  { code: '37', name: 'Andhra Pradesh', isUT: false },
  { code: '38', name: 'Ladakh', isUT: true },
  { code: '97', name: 'Other Territory', isUT: true },
  { code: '99', name: 'Centre Jurisdiction', isUT: false },
];

const STATE_BY_CODE: ReadonlyMap<string, GstState> = new Map(
  GST_STATES.map((s) => [s.code, s]),
);

const STATE_BY_NAME: ReadonlyMap<string, GstState> = new Map(
  GST_STATES.map((s) => [s.name.toLowerCase(), s]),
);

/**
 * Look up a state by its 2-digit GST code.
 */
export function findStateByCode(code: string | null | undefined): GstState | undefined {
  if (!code) return undefined;
  return STATE_BY_CODE.get(code);
}

/**
 * Look up a state by name (case-insensitive). Used to coerce free-text
 * address state fields into a canonical code.
 */
export function findStateByName(name: string | null | undefined): GstState | undefined {
  if (!name) return undefined;
  return STATE_BY_NAME.get(name.trim().toLowerCase());
}

/**
 * Resolve a free-form value (could be code or name) to a canonical state.
 * Returns undefined if no match. Useful for coercing UserAddress.state which
 * is free-text in the current schema.
 */
export function resolveState(value: string | null | undefined): GstState | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  // Try code first (2 digits) then name
  if (/^\d{2}$/.test(trimmed)) {
    return STATE_BY_CODE.get(trimmed);
  }
  return STATE_BY_NAME.get(trimmed.toLowerCase());
}

/**
 * Extract the state code from a GSTIN (first 2 digits).
 */
export function stateCodeFromGstin(gstin: string | null | undefined): string | undefined {
  if (!gstin || gstin.length < 2) return undefined;
  const prefix = gstin.slice(0, 2);
  return STATE_BY_CODE.has(prefix) ? prefix : undefined;
}
