import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { BadRequestException } from '@nestjs/common';
import { Prisma, ReturnStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { ReturnsService } from './returns.service';

/**
 * ReturnsService unit tests — jest-mock-extended, same style as
 * refund.service.spec.ts. Covers the policy gate (window / eligibility), a legal
 * vs illegal state transition, and the QC_PASSED money fan-out (refund once,
 * clawback once, TCS reversal once) + idempotent re-run.
 *
 * TEST GOTCHA (rule 4): the tx-passed mock arg is asserted by identity
 * (`prisma`), never expect.anything() — a jest-mock-extended deep proxy answers
 * every property so expect.anything() mis-reads it as a matcher.
 */
describe('ReturnsService', () => {
  let service: ReturnsService;
  let prisma: DeepMockProxy<PrismaService>;
  let outbox: DeepMockProxy<OutboxService>;
  let email: DeepMockProxy<EmailService>;
  let refund: { refundForReturn: jest.Mock };
  let tcs: { reverse: jest.Mock };
  let notifications: { create: jest.Mock };

  const USER = 'user-1';
  const CUSTOMER = 'cust-1';
  const SELLER = 'seller-1';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    outbox = mockDeep<OutboxService>();
    email = mockDeep<EmailService>();
    refund = { refundForReturn: jest.fn() };
    tcs = { reverse: jest.fn() };
    notifications = { create: jest.fn() };

    service = new ReturnsService(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxService,
      email as unknown as EmailService,
      refund as never,
      undefined, // courier
      tcs as never,
      notifications as never,
    );

    // $transaction: array → Promise.all; callback → run against the mock client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma)) as never);
  });

  // ---------------------------------------------------------------------------
  // Policy gate
  // ---------------------------------------------------------------------------

  describe('requestReturn — policy gate', () => {
    function stubCustomer() {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER } as never);
    }

    it('rejects a return on a non-delivered order', async () => {
      stubCustomer();
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        deletedAt: null,
        status: 'CONFIRMED',
        order: { customerId: CUSTOMER, deliveredAt: new Date() },
        items: [],
      } as never);

      await expect(
        service.requestReturn(USER, {
          sellerOrderId: 'so-1',
          reason: 'x',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
        }),
      ).rejects.toThrow(/delivered/i);
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

    it('rejects a return past the return window', async () => {
      stubCustomer();
      const longAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        deletedAt: null,
        status: 'DELIVERED',
        deliveredAt: longAgo,
        order: { customerId: CUSTOMER, deliveredAt: longAgo },
        items: [{ id: 'oi-1', quantity: 1, name: 'Widget' }],
      } as never);

      await expect(
        service.requestReturn(USER, {
          sellerOrderId: 'so-1',
          reason: 'x',
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
        }),
      ).rejects.toThrow(/window/i);
    });

    it('rejects returning more units than were purchased', async () => {
      stubCustomer();
      const now = new Date();
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        deletedAt: null,
        status: 'DELIVERED',
        deliveredAt: now,
        order: { customerId: CUSTOMER, deliveredAt: now },
        items: [{ id: 'oi-1', quantity: 1, name: 'Widget' }],
      } as never);
      prisma.returnItem.findMany.mockResolvedValue([] as never); // none returned yet

      await expect(
        service.requestReturn(USER, {
          sellerOrderId: 'so-1',
          reason: 'x',
          items: [{ orderItemId: 'oi-1', quantity: 5 }],
        }),
      ).rejects.toThrow(/at most/i);
    });

    it('rejects duplicate orderItemId lines that together exceed the purchased qty (review #1)', async () => {
      stubCustomer();
      const now = new Date();
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        deletedAt: null,
        status: 'DELIVERED',
        deliveredAt: now,
        order: { customerId: CUSTOMER, deliveredAt: now },
        items: [{ id: 'oi-1', quantity: 5, name: 'Widget' }],
      } as never);
      prisma.returnItem.findMany.mockResolvedValue([] as never);

      // Two lines for the SAME order item, each at the full remaining qty. The
      // aggregate (10) exceeds the purchased 5 and must be rejected — no N× refund.
      await expect(
        service.requestReturn(USER, {
          sellerOrderId: 'so-1',
          reason: 'x',
          items: [
            { orderItemId: 'oi-1', quantity: 5 },
            { orderItemId: 'oi-1', quantity: 5 },
          ],
        }),
      ).rejects.toThrow(/at most/i);
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

    it('creates a REQUESTED return within policy', async () => {
      stubCustomer();
      const now = new Date();
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        orderId: 'o-1',
        sellerId: SELLER,
        storeId: 'store-1',
        orderNumber: 'SORD-1',
        deletedAt: null,
        status: 'DELIVERED',
        deliveredAt: now,
        order: { customerId: CUSTOMER, deliveredAt: now },
        items: [{ id: 'oi-1', quantity: 2, name: 'Widget' }],
      } as never);
      prisma.returnItem.findMany.mockResolvedValue([] as never);
      prisma.returnRequest.create.mockResolvedValue({
        id: 'r-1',
        status: ReturnStatus.REQUESTED,
      } as never);
      prisma.seller.findUnique.mockResolvedValue({ userId: 'seller-u' } as never);

      const res = await service.requestReturn(USER, {
        sellerOrderId: 'so-1',
        reason: 'damaged',
        items: [{ orderItemId: 'oi-1', quantity: 1 }],
      });
      expect(res).toMatchObject({ id: 'r-1' });
      expect(prisma.returnRequest.create).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // State-machine guard
  // ---------------------------------------------------------------------------

  describe('state transitions', () => {
    it('allows REQUESTED → APPROVED and enqueues the approval email', async () => {
      prisma.seller.findUnique.mockResolvedValue({ id: SELLER } as never);
      prisma.returnRequest.findUnique
        .mockResolvedValueOnce({
          id: 'r-1',
          sellerId: SELLER,
          status: ReturnStatus.REQUESTED,
        } as never)
        // loadDetail at the end
        .mockResolvedValueOnce({ id: 'r-1', status: ReturnStatus.APPROVED } as never);
      prisma.returnRequest.updateMany.mockResolvedValue({ count: 1 } as never);

      await service.approveReturn(USER, 'r-1');

      expect(prisma.returnRequest.updateMany).toHaveBeenCalled();
      expect(outbox.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: 'email.return_approved' }),
      );
    });

    it('rejects an illegal transition (QC pass from REQUESTED)', async () => {
      prisma.seller.findUnique.mockResolvedValue({ id: SELLER } as never);
      prisma.returnRequest.findUnique.mockResolvedValue({
        id: 'r-1',
        sellerId: SELLER,
        status: ReturnStatus.REQUESTED,
      } as never);

      await expect(service.qcReturn(USER, 'r-1', true)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.returnRequest.updateMany).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // QC_PASSED money fan-out
  // ---------------------------------------------------------------------------

  describe('completeQcPassedRefund — money fan-out', () => {
    function stubQcPassed() {
      prisma.returnRequest.findUnique.mockResolvedValueOnce({
        id: 'r-1',
        status: ReturnStatus.QC_PASSED,
        resolutionType: 'REFUND',
        orderId: 'o-1',
        sellerOrderId: 'so-1',
        sellerId: SELLER,
        returnNumber: 'RMA-1',
        refundId: null,
        approvedById: 'seller-u',
      } as never);
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        payoutStatus: 'PAID',
        payoutAmount: new Prisma.Decimal(100),
        subtotal: new Prisma.Decimal(90),
        taxAmount: new Prisma.Decimal(10),
        shippingAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        items: [
          {
            id: 'oi-1',
            quantity: 1,
            totalPrice: new Prisma.Decimal(90),
            taxAmount: new Prisma.Decimal(10),
            discountAmount: new Prisma.Decimal(0),
          },
        ],
      } as never);
      prisma.returnItem.findMany.mockResolvedValue([
        { orderItemId: 'oi-1', quantity: 1 },
      ] as never);
      refund.refundForReturn.mockResolvedValue({
        id: 'refund-1',
        amount: new Prisma.Decimal(100),
        status: 'PROCESSED',
      });
      prisma.returnRequest.update.mockResolvedValue({} as never);
      prisma.returnRequest.updateMany.mockResolvedValue({ count: 1 } as never);
    }

    it('refunds once, claws back once, reverses TCS once', async () => {
      stubQcPassed();

      await service.completeQcPassedRefund('r-1', 'seller-u');

      expect(refund.refundForReturn).toHaveBeenCalledTimes(1);
      expect(prisma.payoutAdjustment.createMany).toHaveBeenCalledTimes(1);
      // Clawback magnitude = full seller payout (100% returned) against a PAID order.
      const clawArg = prisma.payoutAdjustment.createMany.mock
        .calls[0][0] as any;
      expect(Number(clawArg.data[0].amount)).toBe(100);
      expect(tcs.reverse).toHaveBeenCalledTimes(1);
      // TCS reversal is booked with the return's refund id, inside the tx.
      expect(tcs.reverse).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ id: 'refund-1' }),
        expect.any(Array),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: 'email.return_refunded' }),
      );
    });

    it('is idempotent — a re-run on an already-REFUNDED return writes nothing new', async () => {
      prisma.returnRequest.findUnique.mockResolvedValueOnce({
        id: 'r-1',
        status: ReturnStatus.REFUNDED,
        resolutionType: 'REFUND',
      } as never);

      await service.completeQcPassedRefund('r-1', 'seller-u');

      expect(refund.refundForReturn).not.toHaveBeenCalled();
      expect(prisma.payoutAdjustment.createMany).not.toHaveBeenCalled();
      expect(tcs.reverse).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // REPLACEMENT arm — must NEVER hit the refund / clawback / TCS path.
  // ---------------------------------------------------------------------------

  describe('completeQcPassedReplacement — replacement never refunds', () => {
    it('flips QC_PASSED → REPLACEMENT_APPROVED, emails the customer, and moves NO money', async () => {
      prisma.returnRequest.findUnique.mockResolvedValueOnce({
        id: 'r-2',
        status: ReturnStatus.QC_PASSED,
        resolutionType: 'REPLACEMENT',
        sellerId: SELLER,
        returnNumber: 'RMA-2',
      } as never);
      prisma.returnRequest.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.seller.findUnique.mockResolvedValue({ userId: 'seller-u' } as never);

      await service.completeQcPassedReplacement('r-2', 'seller-u');

      // The single most important guarantee: NO refund, NO clawback, NO TCS.
      expect(refund.refundForReturn).not.toHaveBeenCalled();
      expect(prisma.payoutAdjustment.createMany).not.toHaveBeenCalled();
      expect(tcs.reverse).not.toHaveBeenCalled();

      // Flipped to REPLACEMENT_APPROVED and enqueued the replacement email.
      const flipArg = prisma.returnRequest.updateMany.mock.calls[0][0] as any;
      expect(flipArg.data.status).toBe(ReturnStatus.REPLACEMENT_APPROVED);
      expect(outbox.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          type: 'email.return_replacement_approved',
        }),
      );
      // Seller nudged to ship the swap unit.
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'return_replacement_ship' }),
      );
    });

    it('is idempotent — a re-run once past QC_PASSED writes nothing new', async () => {
      prisma.returnRequest.findUnique.mockResolvedValueOnce({
        id: 'r-2',
        status: ReturnStatus.REPLACEMENT_APPROVED,
        resolutionType: 'REPLACEMENT',
        sellerId: SELLER,
      } as never);

      await service.completeQcPassedReplacement('r-2', 'seller-u');

      expect(prisma.returnRequest.updateMany).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(refund.refundForReturn).not.toHaveBeenCalled();
    });
  });

  describe('requestReturn — replacement resolution gate', () => {
    function stubDeliveredOrder() {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER } as never);
      const now = new Date();
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        orderId: 'o-1',
        sellerId: SELLER,
        storeId: 'store-1',
        orderNumber: 'SORD-1',
        deletedAt: null,
        status: 'DELIVERED',
        deliveredAt: now,
        order: { customerId: CUSTOMER, deliveredAt: now },
        items: [{ id: 'oi-1', quantity: 2, name: 'Widget' }],
      } as never);
      prisma.returnItem.findMany.mockResolvedValue([] as never);
    }

    afterEach(() => {
      delete process.env.RETURNS_ALLOW_REPLACEMENT;
    });

    it('rejects a REPLACEMENT return while the flag is off (default)', async () => {
      stubDeliveredOrder();
      await expect(
        service.requestReturn(USER, {
          sellerOrderId: 'so-1',
          reason: 'defective',
          resolutionType: 'REPLACEMENT' as never,
          items: [{ orderItemId: 'oi-1', quantity: 1 }],
        }),
      ).rejects.toThrow(/not available/i);
      expect(prisma.returnRequest.create).not.toHaveBeenCalled();
    });

    it('allows a REPLACEMENT return when the flag is enabled', async () => {
      process.env.RETURNS_ALLOW_REPLACEMENT = 'true';
      stubDeliveredOrder();
      prisma.returnRequest.create.mockResolvedValue({
        id: 'r-3',
        status: ReturnStatus.REQUESTED,
      } as never);
      prisma.seller.findUnique.mockResolvedValue({ userId: 'seller-u' } as never);

      await service.requestReturn(USER, {
        sellerOrderId: 'so-1',
        reason: 'defective',
        resolutionType: 'REPLACEMENT' as never,
        items: [{ orderItemId: 'oi-1', quantity: 1 }],
      });

      const createArg = prisma.returnRequest.create.mock.calls[0][0] as any;
      expect(createArg.data.resolutionType).toBe('REPLACEMENT');
    });
  });
});
