import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CouponService } from './coupon.service';

/**
 * CouponService seller-ownership tests — jest-mock-extended, same style as
 * payout.service.spec.ts. These lock down the P4-03 authz boundary: a seller
 * must only ever read/write coupons on a store THEY own. Each denial test also
 * asserts the write never reached Prisma (ownership is enforced before the
 * mutation, not merely filtered).
 */
describe('CouponService — seller ownership', () => {
  let service: CouponService;
  let prisma: DeepMockProxy<PrismaService>;

  const USER = 'user-A';
  const SELLER_A = 'seller-A';
  const SELLER_B = 'seller-B';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new CouponService(prisma as unknown as PrismaService);
  });

  /** Caller resolves to seller-A owning store-1. */
  function stubSellerA() {
    prisma.seller.findUnique.mockResolvedValue({
      id: SELLER_A,
      deletedAt: null,
    } as never);
  }

  // ---- getSellerId gate -----------------------------------------------------

  it('rejects a non-seller caller', async () => {
    prisma.seller.findUnique.mockResolvedValue(null as never);
    await expect(service.listForSeller(USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  // ---- listForSeller --------------------------------------------------------

  it('lists only coupons across the caller-owned stores', async () => {
    stubSellerA();
    prisma.store.findMany.mockResolvedValue([{ id: 'store-1' }] as never);
    prisma.coupon.findMany.mockResolvedValue([
      { id: 'c1', storeId: 'store-1', code: 'SAVE10', discountValue: 10 },
    ] as never);

    const rows = await service.listForSeller(USER);

    expect(rows).toHaveLength(1);
    // The query must be scoped to the owned store ids — never unfiltered.
    expect(prisma.coupon.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, storeId: { in: ['store-1'] } },
      }),
    );
  });

  it('denies a storeId filter the caller does not own', async () => {
    stubSellerA();
    prisma.store.findMany.mockResolvedValue([{ id: 'store-1' }] as never);

    await expect(
      service.listForSeller(USER, 'store-not-mine'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.coupon.findMany).not.toHaveBeenCalled();
  });

  // ---- createForSeller ------------------------------------------------------

  it('requires a storeId (no platform-wide coupons for sellers)', async () => {
    stubSellerA();
    await expect(
      service.createForSeller(USER, baseCreateInput({ storeId: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
  });

  it("denies creating a coupon on another seller's store", async () => {
    stubSellerA();
    // store-x belongs to seller-B.
    prisma.store.findUnique.mockResolvedValue({
      sellerId: SELLER_B,
      deletedAt: null,
    } as never);

    await expect(
      service.createForSeller(USER, baseCreateInput({ storeId: 'store-x' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.coupon.create).not.toHaveBeenCalled();
  });

  it('creates when the caller owns the target store', async () => {
    stubSellerA();
    prisma.store.findUnique.mockResolvedValue({
      sellerId: SELLER_A,
      deletedAt: null,
    } as never);
    // Shared create(): code-uniqueness probe → none, then the insert.
    prisma.coupon.findUnique.mockResolvedValue(null as never);
    prisma.coupon.create.mockResolvedValue({
      id: 'c-new',
      storeId: 'store-1',
      code: 'SAVE10',
      discountValue: 10,
    } as never);

    const res = await service.createForSeller(
      USER,
      baseCreateInput({ storeId: 'store-1' }),
    );

    expect(prisma.coupon.create).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ id: 'c-new', storeId: 'store-1' });
  });

  // ---- updateForSeller ------------------------------------------------------

  it("denies updating a coupon on another seller's store", async () => {
    stubSellerA();
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'c1',
      storeId: 'store-x',
      deletedAt: null,
    } as never);
    // store-x belongs to seller-B.
    prisma.store.findUnique.mockResolvedValue({
      sellerId: SELLER_B,
      deletedAt: null,
    } as never);

    await expect(
      service.updateForSeller(USER, { id: 'c1', name: 'hijack' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.coupon.update).not.toHaveBeenCalled();
  });

  it('denies re-scoping a coupon to a store the caller does not own', async () => {
    stubSellerA();
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'c1',
      storeId: 'store-1',
      deletedAt: null,
    } as never);
    prisma.store.findUnique
      // 1st call: assertCouponOwnership → coupon's own store (owned).
      .mockResolvedValueOnce({ sellerId: SELLER_A, deletedAt: null } as never)
      // 2nd call: the requested new store belongs to seller-B.
      .mockResolvedValueOnce({ sellerId: SELLER_B, deletedAt: null } as never);

    await expect(
      service.updateForSeller(USER, { id: 'c1', storeId: 'store-x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.coupon.update).not.toHaveBeenCalled();
  });

  // ---- softDeleteForSeller --------------------------------------------------

  it('denies deleting a platform-wide (unowned) coupon', async () => {
    stubSellerA();
    prisma.coupon.findUnique.mockResolvedValue({
      id: 'c1',
      storeId: null,
      deletedAt: null,
    } as never);

    await expect(
      service.softDeleteForSeller(USER, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.coupon.update).not.toHaveBeenCalled();
  });

  it('404s a missing coupon before any ownership leak', async () => {
    stubSellerA();
    prisma.coupon.findUnique.mockResolvedValue(null as never);
    await expect(
      service.softDeleteForSeller(USER, 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// Minimal valid CreateCouponInput; overrides merged on top.
function baseCreateInput(
  overrides: Record<string, unknown> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    code: 'SAVE10',
    name: 'Save 10%',
    discountType: 'percentage',
    discountValue: 10,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: '2026-12-31T00:00:00.000Z',
    ...overrides,
  };
}
