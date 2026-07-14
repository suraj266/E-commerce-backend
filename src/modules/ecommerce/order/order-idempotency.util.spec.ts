import { Prisma } from '@prisma/client';
import { isIdempotencyConflict } from './order-idempotency.util';

function p2002(target: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

describe('isIdempotencyConflict', () => {
  it('is true for the idempotency index (array target)', () => {
    expect(isIdempotencyConflict(p2002(['customerId', 'idempotencyKey']))).toBe(
      true,
    );
  });

  it('is true for the idempotency index (string constraint-name target)', () => {
    expect(
      isIdempotencyConflict(p2002('Order_customerId_idempotencyKey_key')),
    ).toBe(true);
  });

  it('is FALSE for an unrelated unique (orderNumber) — must not be treated as a replay', () => {
    expect(isIdempotencyConflict(p2002(['orderNumber']))).toBe(false);
    expect(isIdempotencyConflict(p2002(['orderId', 'sellerId']))).toBe(false);
  });

  it('is false for a non-P2002 Prisma error', () => {
    const err = new Prisma.PrismaClientKnownRequestError('fk', {
      code: 'P2003',
      clientVersion: 'test',
      meta: {},
    });
    expect(isIdempotencyConflict(err)).toBe(false);
  });

  it('is false for a plain Error', () => {
    expect(isIdempotencyConflict(new Error('boom'))).toBe(false);
  });
});
