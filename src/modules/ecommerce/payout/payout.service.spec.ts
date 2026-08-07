import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PayoutAdjustmentStatus, PayoutStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { PayoutService } from './payout.service';

/**
 * PayoutService unit tests — Phase-1 jest-mock-extended style. Cover the
 * refund-netting preview maths, the settle-once race skip, and the disburse
 * state guards.
 */
describe('PayoutService', () => {
  let service: PayoutService;
  let prisma: DeepMockProxy<PrismaService>;
  let email: DeepMockProxy<EmailService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    email = mockDeep<EmailService>();
    service = new PayoutService(
      prisma as unknown as PrismaService,
      email as unknown as EmailService,
    );
  });

  describe('previewPayoutRun', () => {
    it('aggregates per seller and nets out PROCESSED refunds', async () => {
      prisma.sellerOrder.findMany.mockResolvedValue([
        {
          id: 'so-1',
          sellerId: 's1',
          payoutAmount: 100,
          currencyCode: 'INR',
          orderNumber: 'SORD-1',
          seller: { displayName: 'Store One' },
        },
        {
          id: 'so-2',
          sellerId: 's1',
          payoutAmount: 50,
          currencyCode: 'INR',
          orderNumber: 'SORD-2',
          seller: { displayName: 'Store One' },
        },
      ] as never);
      prisma.refund.groupBy.mockResolvedValue([
        { sellerOrderId: 'so-1', _sum: { amount: 20 } },
      ] as never);

      const preview = await service.previewPayoutRun();
      expect(preview).toHaveLength(1);
      expect(preview[0]).toMatchObject({
        sellerId: 's1',
        itemCount: 2,
        grossAmount: 150,
        refundAdjustment: 20,
        netAmount: 130,
      });
    });

    it('excludes a seller order fully clawed back by refunds', async () => {
      prisma.sellerOrder.findMany.mockResolvedValue([
        {
          id: 'so-1',
          sellerId: 's1',
          payoutAmount: 100,
          currencyCode: 'INR',
          orderNumber: 'SORD-1',
          seller: { displayName: 'Store One' },
        },
      ] as never);
      prisma.refund.groupBy.mockResolvedValue([
        { sellerOrderId: 'so-1', _sum: { amount: 100 } },
      ] as never);

      const preview = await service.previewPayoutRun();
      expect(preview).toHaveLength(0);
    });
  });

  describe('myPayouts — seller scoping', () => {
    it('resolves the caller sellerId and scopes the list to it', async () => {
      prisma.seller.findUnique.mockResolvedValue({
        id: 'seller-1',
        deletedAt: null,
      } as never);
      prisma.$transaction.mockResolvedValue([[], 0] as never);

      await service.myPayouts('user-1', { page: 1, pageSize: 10 });

      // The findMany used inside listPayouts must be filtered to the resolved
      // seller — never unscoped — so a seller can't read another's payouts.
      expect(prisma.payout.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sellerId: 'seller-1' }),
        }),
      );
    });

    it('rejects a non-seller caller before listing anything', async () => {
      prisma.seller.findUnique.mockResolvedValue(null as never);
      await expect(service.myPayouts('user-x')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.payout.findMany).not.toHaveBeenCalled();
    });
  });

  describe('createPayoutRun', () => {
    it('skips a seller when a settle-once race hits P2002', async () => {
      prisma.sellerOrder.findMany.mockResolvedValue([
        {
          id: 'so-1',
          sellerId: 's1',
          payoutAmount: 100,
          currencyCode: 'INR',
          orderNumber: 'SORD-1',
          seller: { displayName: 'Store One' },
        },
      ] as never);
      prisma.refund.groupBy.mockResolvedValue([] as never);
      prisma.sellerPayoutAccount.findFirst.mockResolvedValue(null as never);

      // Run the transaction callback against the mocked prisma client.
      (prisma.$transaction as unknown as jest.Mock).mockImplementation(
        async (cb: any) => cb(prisma),
      );
      prisma.payout.create.mockResolvedValue({ id: 'payout-1' } as never);
      prisma.payoutItem.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );
      prisma.payout.findMany.mockResolvedValue([] as never);

      const res = await service.createPayoutRun('admin-1');
      expect(res).toEqual([]);
    });
  });

  describe('markPayoutPaid', () => {
    it('is idempotent for an already-PAID payout', async () => {
      prisma.payout.findUnique.mockResolvedValue({
        id: 'payout-1',
        status: PayoutStatus.PAID,
        items: [],
        seller: { businessEmail: 'a@b.com', displayName: 'S' },
      } as never);

      await service.markPayoutPaid('admin-1', {
        payoutId: 'payout-1',
        utr: 'UTR1',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects marking a non-PROCESSING payout paid', async () => {
      prisma.payout.findUnique.mockResolvedValue({
        id: 'payout-1',
        status: PayoutStatus.FAILED,
        items: [],
        seller: { businessEmail: 'a@b.com', displayName: 'S' },
      } as never);

      await expect(
        service.markPayoutPaid('admin-1', { payoutId: 'payout-1', utr: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('markPayoutFailed', () => {
    it('rejects failing a non-PROCESSING payout', async () => {
      prisma.payout.findUnique.mockResolvedValue({
        id: 'payout-1',
        status: PayoutStatus.PAID,
        items: [],
      } as never);
      await expect(
        service.markPayoutFailed('payout-1', 'bank bounce'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reverts absorbed clawback adjustments to PENDING so they carry forward (review #4)', async () => {
      prisma.payout.findUnique.mockResolvedValue({
        id: 'payout-1',
        status: PayoutStatus.PROCESSING,
        items: [{ sellerOrderId: 'so-1' }],
      } as never);
      prisma.$transaction.mockResolvedValue([] as never);

      await service.markPayoutFailed('payout-1', 'bank bounce');

      // The APPLIED clawbacks on this dead payout must be released back to
      // PENDING (payoutId/appliedAt cleared) so the next run re-absorbs them —
      // otherwise the seller is overpaid by the un-recovered commission.
      expect(prisma.payoutAdjustment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            payoutId: 'payout-1',
            status: PayoutAdjustmentStatus.APPLIED,
          }),
          data: expect.objectContaining({
            status: PayoutAdjustmentStatus.PENDING,
            payoutId: null,
            appliedAt: null,
          }),
        }),
      );
    });
  });
});
