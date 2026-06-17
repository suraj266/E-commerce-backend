import { getFiscalYear, sellerCodeFrom } from './invoice-number.service';

describe('getFiscalYear', () => {
  // Construct dates with the local Date constructor so server timezone
  // (typically IST in production) doesn't shift the month boundary.
  it('returns FY25-26 for mid-March', () => {
    expect(getFiscalYear(new Date(2026, 2, 15))).toBe('FY25-26'); // March
  });

  it('rolls over to FY26-27 on April 1', () => {
    expect(getFiscalYear(new Date(2026, 3, 1))).toBe('FY26-27'); // April
  });

  it('FY26-27 covers January 2027', () => {
    expect(getFiscalYear(new Date(2027, 0, 15))).toBe('FY26-27');
  });

  it('FY26-27 ends on March 31, 2027', () => {
    expect(getFiscalYear(new Date(2027, 2, 31))).toBe('FY26-27');
  });
});

describe('sellerCodeFrom', () => {
  it('takes first 4 hex chars and uppercases', () => {
    expect(sellerCodeFrom('a1b2c3d4-1111-2222-3333-444444444444')).toBe('A1B2');
  });

  it('strips dashes before slicing', () => {
    // Dashed slice would have been "a1b2" anyway, but force it to
    // demonstrate the slash robustness — UUIDs always have the dash at
    // position 8, but the function is resilient to malformed input.
    expect(sellerCodeFrom('a-b-1-2cdef')).toBe('AB12');
  });
});
