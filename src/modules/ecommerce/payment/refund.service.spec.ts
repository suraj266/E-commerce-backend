import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { BadRequestException } from '@nestjs/common';
import {
  PaymentGateway,
  PaymentTransactionStatus,
  PayoutStatus,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { PaymentConfigService } from './payment-config.service';
import { RefundService } from './refund.service';
import type { IPaymentGateway } from './gateways/payment-gateway.interface';

/**
 * RefundService unit tests — Phase-1 jest-mock-extended style. Focus on the
 * validation/guard paths (over-refund ceiling, payout coupling, idempotency)
 * that guard money movement, without exercising the full gateway round-trip.
 */
describe('RefundService', () => {
  let service: RefundService;
  let prisma: DeepMockProxy<PrismaService>;
  let configService: DeepMockProxy<PaymentConfigService>;
  let email: DeepMockProxy<EmailService>;
  let gateway: DeepMockProxy<IPaymentGateway>;
  let gatewayMap: Map<string, IPaymentGateway>;

  const CUSTOMER_ID = 'cust-1';
  const USER_ID = 'user-1';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    configService = mockDeep<PaymentConfigService>();
    email = mockDeep<EmailService>();
    gateway = mockDeep<IPaymentGateway>();
    gatewayMap = new Map<string, IPaymentGateway>([['RAZORPAY', gateway]]);
    service = new RefundService(
      prisma as unknown as PrismaService,
      configService as unknown as PaymentConfigService,
      gatewayMap,
      email as unknown as EmailService,
    );

    // $transaction: array form → Promise.all; callback form → run with the same
    // deep-mocked client as `tx` (all model methods exist on it).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.$transaction.mockImplementation(((arg: any) =>
      Array.isArray(arg) ? Promise.all(arg) : arg(prisma)) as never);
  });

  /** A finalize-shaped refund (what finalizeRefund's include re-reads). */
  function finalizeRefund(overrides: Record<string, unknown> = {}) {
    return {
      id: 'refund-1',
      orderId: 'order-1',
      sellerOrderId: null,
      paymentId: 'pay-1',
      amount: 100,
      restock: false,
      approvedById: 'admin-1',
      status: RefundStatus.PROCESSING,
      payment: capturedPayment,
      order: {
        id: 'order-1',
        status: 'CONFIRMED',
        orderNumber: 'ORD-1',
        sellerOrders: [
          {
            id: 'so-1',
            storeId: 'store-1',
            status: 'CONFIRMED',
            payoutStatus: PayoutStatus.PENDING,
            subtotal: 90,
            taxAmount: 10,
            shippingAmount: 0,
            discountAmount: 0,
            shippedAt: null,
            orderNumber: 'SORD-1',
          },
        ],
        customer: { user: { email: 'buyer@test', name: 'Buyer' } },
      },
      ...overrides,
    };
  }

  const capturedPayment = {
    id: 'pay-1',
    orderId: 'order-1',
    amount: 100,
    gateway: PaymentGateway.RAZORPAY,
    gatewayPaymentId: 'pay_gw_1',
    status: PaymentTransactionStatus.CAPTURED,
    createdAt: new Date(),
  };

  function stubHappyRequestPath() {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      customerId: CUSTOMER_ID,
      deletedAt: null,
    } as never);
    prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID } as never);
    prisma.payment.findFirst.mockResolvedValue(capturedPayment as never);
    prisma.sellerOrder.findMany.mockResolvedValue([
      { id: 'so-1', payoutStatus: PayoutStatus.PENDING },
    ] as never);
  }

  describe('requestRefund', () => {
    it('rejects an over-refund above the refundable ceiling', async () => {
      stubHappyRequestPath();
      // No prior refunds → maxRefundable = 100.
      prisma.refund.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      } as never);

      await expect(
        service.requestRefund(USER_ID, { orderId: 'order-1', amount: 250 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('blocks a refund when a seller order is already in a payout run', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        customerId: CUSTOMER_ID,
        deletedAt: null,
      } as never);
      prisma.customer.findUnique.mockResolvedValue({
        id: CUSTOMER_ID,
      } as never);
      prisma.payment.findFirst.mockResolvedValue(capturedPayment as never);
      prisma.sellerOrder.findMany.mockResolvedValue([
        { id: 'so-1', payoutStatus: PayoutStatus.PAID },
      ] as never);

      await expect(
        service.requestRefund(USER_ID, { orderId: 'order-1' }),
      ).rejects.toThrow(/payout/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('creates a REQUESTED refund within the ceiling', async () => {
      stubHappyRequestPath();
      prisma.refund.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      } as never);
      prisma.refund.create.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.REQUESTED,
      } as never);

      const res = await service.requestRefund(USER_ID, {
        orderId: 'order-1',
        amount: 40,
        reason: 'damaged',
      });
      expect(res).toMatchObject({ id: 'refund-1' });
      expect(prisma.refund.create).toHaveBeenCalledTimes(1);
      const arg = prisma.refund.create.mock.calls[0][0] as any;
      expect(arg.data.status).toBe(RefundStatus.REQUESTED);
      expect(arg.data.requestedById).toBe(USER_ID);
    });
  });

  describe('approveRefund', () => {
    it('is idempotent for an already-PROCESSED refund (no gateway call)', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.PROCESSED,
        payment: capturedPayment,
      } as never);

      const res = await service.approveRefund('admin-1', 'refund-1');
      expect(res).toMatchObject({ id: 'refund-1' });
      expect(gateway.refund).not.toHaveBeenCalled();
      expect(prisma.refund.update).not.toHaveBeenCalled();
    });

    it('refuses to refund a COD payment through the gateway', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.REQUESTED,
        amount: 50,
        payment: {
          ...capturedPayment,
          gateway: PaymentGateway.COD,
          gatewayPaymentId: null,
        },
      } as never);

      await expect(
        service.approveRefund('admin-1', 'refund-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(gateway.refund).not.toHaveBeenCalled();
    });
  });

  describe('rejectRefund', () => {
    it('marks a REQUESTED refund REJECTED', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.REQUESTED,
      } as never);
      prisma.refund.update.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.REJECTED,
      } as never);

      await service.rejectRefund('admin-1', 'refund-1', 'not eligible');
      const arg = prisma.refund.update.mock.calls[0][0] as any;
      expect(arg.data.status).toBe(RefundStatus.REJECTED);
      expect(arg.data.failureReason).toBe('not eligible');
    });

    it('refuses to reject a non-REQUESTED refund', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.PROCESSED,
      } as never);
      await expect(
        service.rejectRefund('admin-1', 'refund-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('requestRefund — scope + eligibility guards', () => {
    it('rejects when neither orderId nor sellerOrderId is provided', async () => {
      await expect(service.requestRefund(USER_ID, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when the caller does not own the order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        customerId: 'someone-else',
        deletedAt: null,
      } as never);
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID } as never);
      await expect(
        service.requestRefund(USER_ID, { orderId: 'order-1' }),
      ).rejects.toThrow(/do not own/i);
    });

    it('rejects when there is no captured gateway payment', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        customerId: CUSTOMER_ID,
        deletedAt: null,
      } as never);
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID } as never);
      prisma.payment.findFirst.mockResolvedValue(null as never);
      await expect(
        service.requestRefund(USER_ID, { orderId: 'order-1' }),
      ).rejects.toThrow(/no captured payment/i);
    });
  });

  describe('approveRefund — the money mover', () => {
    function stubApprove(gatewayStatus: string) {
      prisma.refund.findUnique
        // 1) initial load (with payment)
        .mockResolvedValueOnce({
          id: 'refund-1',
          orderId: 'order-1',
          sellerOrderId: null,
          amount: 100,
          reason: 'damaged',
          restock: false,
          status: RefundStatus.REQUESTED,
          payment: capturedPayment,
        } as never)
        // 2) finalize re-read (with includes)
        .mockResolvedValueOnce(finalizeRefund() as never)
        // 3) return value
        .mockResolvedValueOnce({
          id: 'refund-1',
          status: RefundStatus.PROCESSED,
        } as never);
      // 1st aggregate = approve-time over-refund re-check (no OTHER refunds → 0);
      // subsequent = finalize's payment-level total (this refund now PROCESSED → 100 → full).
      prisma.refund.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 0 } } as never)
        .mockResolvedValue({ _sum: { amount: 100 } } as never);
      prisma.sellerOrder.findMany.mockResolvedValue([
        { id: 'so-1', status: 'REFUNDED', payoutStatus: PayoutStatus.PENDING },
      ] as never);
      prisma.refund.update.mockResolvedValue({ id: 'refund-1' } as never);
      prisma.refund.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.payment.update.mockResolvedValue({} as never);
      prisma.sellerOrder.update.mockResolvedValue({} as never);
      prisma.orderStatusHistory.create.mockResolvedValue({} as never);
      prisma.order.update.mockResolvedValue({} as never);
      configService.getDecryptedCredentials.mockResolvedValue({} as never);
      gateway.refund.mockResolvedValue({
        refundId: 'rfnd_gw_1',
        status: gatewayStatus,
      });
      email.send.mockResolvedValue({ sent: true } as never);
    }

    it('processes a full refund: calls the gateway once, finalizes to REFUNDED, emails the buyer', async () => {
      stubApprove('processed');

      await service.approveRefund('admin-1', 'refund-1');

      expect(gateway.refund).toHaveBeenCalledTimes(1);
      // PROCESSING persisted before the gateway call, gatewayRefundId after.
      const statuses = prisma.refund.update.mock.calls.map(
        (c) => (c[0] as any).data.status,
      );
      expect(statuses).toContain(RefundStatus.PROCESSING);
      // Full refund (amount 100 == payment 100) → Payment REFUNDED.
      const payData = prisma.payment.update.mock.calls[0][0] as any;
      expect(payData.data.status).toBe(PaymentTransactionStatus.REFUNDED);
      // Race-safe PROCESSED flip happened.
      expect(prisma.refund.updateMany).toHaveBeenCalled();
      // Buyer emailed.
      expect(email.send).toHaveBeenCalledWith(
        'order_refunded',
        'buyer@test',
        expect.objectContaining({ orderNumber: 'ORD-1' }),
      );
    });

    it('marks the refund FAILED and throws when the gateway refund call throws', async () => {
      stubApprove('processed');
      gateway.refund.mockRejectedValue(new Error('gateway 500'));

      await expect(
        service.approveRefund('admin-1', 'refund-1'),
      ).rejects.toBeInstanceOf(BadRequestException);

      const failed = prisma.refund.update.mock.calls.find(
        (c) => (c[0] as any).data.status === RefundStatus.FAILED,
      );
      expect(failed).toBeDefined();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('leaves the refund PROCESSING (no finalize) when the gateway result is pending', async () => {
      stubApprove('pending');

      await service.approveRefund('admin-1', 'refund-1');

      expect(gateway.refund).toHaveBeenCalledTimes(1);
      // No finalize → no PROCESSED flip, no buyer email yet.
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(email.send).not.toHaveBeenCalled();
    });
  });

  describe('handleRefundWebhook', () => {
    it('finalizes a PROCESSING refund on refund.processed', async () => {
      prisma.refund.findUnique
        .mockResolvedValueOnce({
          id: 'refund-1',
          status: RefundStatus.PROCESSING,
        } as never)
        .mockResolvedValueOnce(finalizeRefund() as never);
      prisma.refund.updateMany.mockResolvedValue({ count: 1 } as never);
      prisma.refund.aggregate.mockResolvedValue({
        _sum: { amount: 100 },
      } as never);
      prisma.payment.update.mockResolvedValue({} as never);
      prisma.sellerOrder.update.mockResolvedValue({} as never);
      prisma.sellerOrder.findMany.mockResolvedValue([
        { status: 'REFUNDED' },
      ] as never);
      prisma.order.update.mockResolvedValue({} as never);
      prisma.orderStatusHistory.create.mockResolvedValue({} as never);
      email.send.mockResolvedValue({ sent: true } as never);

      await service.handleRefundWebhook({ id: 'rfnd_gw_1', status: 'processed' });

      expect(prisma.refund.updateMany).toHaveBeenCalled();
      expect(email.send).toHaveBeenCalledWith(
        'order_refunded',
        'buyer@test',
        expect.anything(),
      );
    });

    it('marks the refund FAILED on refund.failed', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.PROCESSING,
      } as never);
      prisma.refund.update.mockResolvedValue({} as never);

      await service.handleRefundWebhook({ id: 'rfnd_gw_1', status: 'failed' });

      const data = prisma.refund.update.mock.calls[0][0] as any;
      expect(data.data.status).toBe(RefundStatus.FAILED);
    });

    it('no-ops for an unknown gatewayRefundId (webhook raced ahead)', async () => {
      prisma.refund.findUnique.mockResolvedValue(null as never);
      await service.handleRefundWebhook({ id: 'nope', status: 'processed' });
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(prisma.refund.update).not.toHaveBeenCalled();
    });

    it('is idempotent for an already-terminal refund', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.PROCESSED,
      } as never);
      await service.handleRefundWebhook({ id: 'rfnd_gw_1', status: 'processed' });
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });

    it('ignores an entity with no id', async () => {
      await service.handleRefundWebhook({ status: 'processed' });
      expect(prisma.refund.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('myRefunds scopes to the caller customer', async () => {
      prisma.customer.findUnique.mockResolvedValue({ id: CUSTOMER_ID } as never);
      prisma.refund.findMany.mockResolvedValue([{ id: 'r1' }] as never);
      const res = await service.myRefunds(USER_ID);
      expect(res).toEqual([{ id: 'r1' }]);
      const arg = prisma.refund.findMany.mock.calls[0][0] as any;
      expect(arg.where.order.customerId).toBe(CUSTOMER_ID);
    });

    it('listRefunds paginates and filters by status', async () => {
      prisma.$transaction.mockResolvedValueOnce([[{ id: 'r1' }], 1] as never);
      const res = await service.listRefunds({
        status: RefundStatus.REQUESTED,
        page: 1,
        pageSize: 10,
      });
      expect(res).toMatchObject({ totalCount: 1, currentPage: 1, pageSize: 10 });
    });
  });
});
