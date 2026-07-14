import { expectedPaise, paidAmountMatches } from './payment-amount.util';

describe('expectedPaise', () => {
  it('converts rupees to integer paise', () => {
    expect(expectedPaise(100)).toBe(10000);
    expect(expectedPaise('100.50')).toBe(10050);
    expect(expectedPaise(0)).toBe(0);
  });

  it('rounds to the nearest paise (no float drift)', () => {
    expect(expectedPaise(118.29)).toBe(11829);
  });
});

describe('paidAmountMatches', () => {
  // Payment.amount already INCLUDES the processing fee (= the amount the gateway
  // order was created for). These assertions lock in comparing against it.
  const payment = { amount: 118 as number, currency: 'INR' };

  it('accepts an exact paise + currency match', () => {
    expect(paidAmountMatches(11800, 'INR', payment)).toBe(true);
  });

  it('accepts a case-insensitive currency match', () => {
    expect(paidAmountMatches(11800, 'inr', payment)).toBe(true);
  });

  it('rejects an off-by-one-paise underpayment', () => {
    expect(paidAmountMatches(11799, 'INR', payment)).toBe(false);
  });

  it('rejects a currency mismatch even when the amount matches', () => {
    expect(paidAmountMatches(11800, 'USD', payment)).toBe(false);
  });

  it('rejects paying only the base when the fee is included in the expected amount', () => {
    const withFee = { amount: 105.5 as number, currency: 'INR' };
    expect(paidAmountMatches(10550, 'INR', withFee)).toBe(true); // full amount incl. fee
    expect(paidAmountMatches(10000, 'INR', withFee)).toBe(false); // fee skipped
  });

  it('rejects a non-finite captured amount', () => {
    expect(paidAmountMatches(Number.NaN, 'INR', payment)).toBe(false);
  });
});
