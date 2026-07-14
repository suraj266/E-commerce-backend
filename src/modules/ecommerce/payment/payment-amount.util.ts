import type { Prisma } from '@prisma/client';

/**
 * The gateway session is created for `Payment.amount` (order total + processing
 * fee) in the major unit, and Razorpay reports captured amounts in paise. So the
 * authoritative check is: captured paise === round(Payment.amount * 100) AND the
 * currencies match. Compare against `Payment.amount`, NOT `Order.totalAmount`
 * (which excludes the processing fee). Always compare integer paise — never
 * floats — to avoid rounding false-negatives.
 */
export function expectedPaise(
  amount: Prisma.Decimal | number | string,
): number {
  return Math.round(Number(amount) * 100);
}

export function paidAmountMatches(
  paidPaise: number,
  paidCurrency: string,
  expected: { amount: Prisma.Decimal | number | string; currency: string },
): boolean {
  if (!Number.isFinite(paidPaise)) return false;
  const currencyMatches =
    (paidCurrency ?? '').toUpperCase() ===
    (expected.currency ?? '').toUpperCase();
  return currencyMatches && paidPaise === expectedPaise(expected.amount);
}
