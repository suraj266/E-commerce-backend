import {
  fromInclusiveMrp,
  getTaxKind,
  round2,
  splitTax,
  sumBreakups,
} from './place-of-supply';

describe('getTaxKind', () => {
  it('returns INTRA_STATE when seller and buyer share a state code', () => {
    expect(getTaxKind('27', '27')).toBe('INTRA_STATE');
  });

  it('returns INTER_STATE when state codes differ', () => {
    expect(getTaxKind('27', '29')).toBe('INTER_STATE');
  });

  it('throws when either state code is missing', () => {
    expect(() => getTaxKind('', '27')).toThrow(/seller state/);
    expect(() => getTaxKind('27', null)).toThrow(/buyer state/);
    expect(() => getTaxKind(undefined, undefined)).toThrow();
  });
});

describe('splitTax — INTRA_STATE', () => {
  it('splits 18% GST evenly between CGST and SGST', () => {
    const b = splitTax(100, 18, 'INTRA_STATE');
    expect(b.cgstRate).toBe(9);
    expect(b.cgstAmount).toBe(9);
    expect(b.sgstRate).toBe(9);
    expect(b.sgstAmount).toBe(9);
    expect(b.igstRate).toBe(0);
    expect(b.igstAmount).toBe(0);
    expect(b.totalTax).toBe(18);
    expect(b.totalWithTax).toBe(118);
  });

  it('handles 5% GST (odd rate) without precision loss', () => {
    const b = splitTax(100, 5, 'INTRA_STATE');
    expect(b.cgstRate).toBe(2.5);
    expect(b.cgstAmount).toBe(2.5);
    expect(b.sgstAmount).toBe(2.5);
    expect(b.totalTax).toBe(5);
  });

  it('includes cess in totalTax for INTRA_STATE', () => {
    const b = splitTax(100, 18, 'INTRA_STATE', 22);
    expect(b.cessRate).toBe(22);
    expect(b.cessAmount).toBe(22);
    expect(b.totalTax).toBe(40); // 9 + 9 + 22
    expect(b.totalWithTax).toBe(140);
  });
});

describe('splitTax — INTER_STATE', () => {
  it('charges 18% GST as IGST, zero CGST/SGST', () => {
    const b = splitTax(100, 18, 'INTER_STATE');
    expect(b.cgstAmount).toBe(0);
    expect(b.sgstAmount).toBe(0);
    expect(b.igstRate).toBe(18);
    expect(b.igstAmount).toBe(18);
    expect(b.totalTax).toBe(18);
  });

  it('charges full rate IGST plus cess for inter-state', () => {
    const b = splitTax(100, 18, 'INTER_STATE', 22);
    expect(b.igstAmount).toBe(18);
    expect(b.cessAmount).toBe(22);
    expect(b.totalTax).toBe(40);
  });
});

describe('splitTax — error handling', () => {
  it('rejects negative taxable value', () => {
    expect(() => splitTax(-10, 18, 'INTRA_STATE')).toThrow(/taxableValue/);
  });

  it('rejects NaN rate', () => {
    expect(() => splitTax(100, NaN, 'INTRA_STATE')).toThrow(/totalRate/);
  });

  it('rejects negative cess', () => {
    expect(() => splitTax(100, 18, 'INTRA_STATE', -1)).toThrow(/cessRate/);
  });

  it('accepts zero rate (e.g. exempt goods)', () => {
    const b = splitTax(100, 0, 'INTRA_STATE');
    expect(b.totalTax).toBe(0);
    expect(b.totalWithTax).toBe(100);
  });
});

describe('fromInclusiveMrp', () => {
  it('back-calculates 118 MRP at 18% → 100 taxable', () => {
    expect(fromInclusiveMrp(118, 18)).toBe(100);
  });

  it('back-calculates 105 MRP at 5% → 100 taxable', () => {
    expect(fromInclusiveMrp(105, 5)).toBe(100);
  });

  it('back-calculates MRP with cess included in divisor', () => {
    // ₹100 taxable + 18% GST (₹18) + 22% cess (₹22) = ₹140
    expect(fromInclusiveMrp(140, 18, 22)).toBe(100);
  });

  it('round-trips: split(fromInclusive(118, 18), 18) sums to 118', () => {
    const taxable = fromInclusiveMrp(118, 18);
    const b = splitTax(taxable, 18, 'INTRA_STATE');
    expect(round2(b.totalWithTax)).toBe(118);
  });

  it('rejects invalid mrp', () => {
    expect(() => fromInclusiveMrp(-10, 18)).toThrow(/mrp/);
    expect(() => fromInclusiveMrp(NaN, 18)).toThrow(/mrp/);
  });

  it('rejects rate combination summing to non-positive divisor', () => {
    // Hypothetical (won't happen in real GST) — guards against bad input.
    expect(() => fromInclusiveMrp(100, -50, -60)).toThrow();
  });
});

describe('sumBreakups', () => {
  it('returns zeros for empty input', () => {
    const sum = sumBreakups([]);
    expect(sum.taxableValue).toBe(0);
    expect(sum.totalTax).toBe(0);
  });

  it('aggregates two intra-state lines', () => {
    const a = splitTax(100, 18, 'INTRA_STATE');
    const b = splitTax(50, 18, 'INTRA_STATE');
    const sum = sumBreakups([a, b]);
    expect(sum.taxableValue).toBe(150);
    expect(sum.cgstAmount).toBe(13.5); // 9 + 4.5
    expect(sum.sgstAmount).toBe(13.5);
    expect(sum.totalTax).toBe(27);
  });

  it('aggregates two inter-state lines with cess', () => {
    const a = splitTax(100, 18, 'INTER_STATE', 22);
    const b = splitTax(200, 18, 'INTER_STATE', 22);
    const sum = sumBreakups([a, b]);
    expect(sum.igstAmount).toBe(54); // 18 + 36
    expect(sum.cessAmount).toBe(66); // 22 + 44
    expect(sum.totalTax).toBe(120);
  });
});

describe('round2', () => {
  it('rounds to 2 decimals using arithmetic rounding', () => {
    // 1.005 is famously inexact in IEEE-754 (actually 1.00499...). We
    // accept arithmetic rounding rather than banker's rounding — currency
    // is the only use site and a ±1 paisa drift is below display precision.
    expect(round2(1.004)).toBe(1);
    expect(round2(1.006)).toBe(1.01);
    expect(round2(99.999)).toBe(100);
    expect(round2(0)).toBe(0);
  });
});
