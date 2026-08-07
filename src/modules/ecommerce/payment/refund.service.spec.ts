import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { BadRequestException } from '@nestjs/common';
import {
  OrderStatus,
  PaymentGateway,
  PaymentTransactionStatus,
  PayoutStatus,
  RefundStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { PaymentConfigService } from './payment-config.service';
import { RefundService } from './refund.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
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
  let outbox: DeepMockProxy<OutboxService>;
  let gateway: DeepMockProxy<IPaymentGateway>;
  let gatewayMap: Map<string, IPaymentGateway>;

  const CUSTOMER_ID = 'cust-1';
  const USER_ID = 'user-1';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    configService = mockDeep<PaymentConfigService>();
    email = mockDeep<EmailService>();
    outbox = mockDeep<OutboxService>();
    gateway = mockDeep<IPaymentGateway>();
    gatewayMap = new Map<string, IPaymentGateway>([['RAZORPAY', gateway]]);
    service = new RefundService(
      prisma as unknown as PrismaService,
      configService as unknown as PaymentConfigService,
      gatewayMap,
      email as unknown as EmailService,
      outbox as unknown as OutboxService,
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

  describe('refundForReturn — idempotent per return (no double refund on resume)', () => {
    it('reuses the refund already linked to the return instead of creating a second', async () => {
      prisma.payment.findFirst.mockResolvedValue(capturedPayment as never);
      // A prior attempt already reserved + linked a refund for this return
      // (the crash-and-resume scenario the reconciliation cron re-drives).
      prisma.returnRequest.findUnique.mockResolvedValue({
        refundId: 'refund-1',
      } as never);
      // The linked refund is already PROCESSED → approveRefund is a no-op.
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.PROCESSED,
        payment: capturedPayment,
      } as never);

      const res = await service.refundForReturn({
        orderId: 'order-1',
        sellerOrderId: 'so-1',
        amount: 100,
        returnRequestId: 'ret-1',
      });

      expect(res).toMatchObject({ id: 'refund-1' });
      // The critical guarantee: NO second refund row, NO second gateway refund.
      expect(prisma.refund.create).not.toHaveBeenCalled();
      expect(gateway.refund).not.toHaveBeenCalled();
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

    it('processes a full refund: calls the gateway once, finalizes to REFUNDED, enqueues the buyer email', async () => {
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
      // Buyer email is now DURABLE: enqueued in the finalize tx (sent by the
      // outbox worker), not sent inline.
      expect(outbox.enqueue).toHaveBeenCalledWith(
        // arg0 is the tx client (=== the mocked prisma inside $transaction). A
        // jest-mock-extended deep-mock proxy is mis-read by expect.anything()
        // (the proxy answers every prop, so jest treats it as an asymmetric
        // matcher). Assert the tx identity directly instead — this also proves
        // the enqueue happened INSIDE the finalize transaction.
        prisma,
        expect.objectContaining({ type: 'email.order_refunded' }),
      );
      expect(email.send).not.toHaveBeenCalled();
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
      // Buyer email enqueued durably in the finalize tx (sent by the worker).
      expect(outbox.enqueue).toHaveBeenCalledWith(
        // arg0 is the tx client (=== the mocked prisma inside $transaction). A
        // jest-mock-extended deep-mock proxy is mis-read by expect.anything()
        // (the proxy answers every prop, so jest treats it as an asymmetric
        // matcher). Assert the tx identity directly instead — this also proves
        // the enqueue happened INSIDE the finalize transaction.
        prisma,
        expect.objectContaining({ type: 'email.order_refunded' }),
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

  describe('disburseManualRefund — COD manual money loop', () => {
    const codPayment = {
      ...capturedPayment,
      gateway: PaymentGateway.COD,
      gatewayPaymentId: null,
    };

    function stubDisburse() {
      prisma.refund.findUnique
        // 1) disburse initial load (with payment) — REQUESTED COD refund.
        .mockResolvedValueOnce({
          id: 'refund-1',
          orderId: 'order-1',
          sellerOrderId: null,
          amount: 100,
          reason: 'Return / RMA',
          restock: false,
          status: RefundStatus.REQUESTED,
          payment: codPayment,
        } as never)
        // 2) finalizeRefund re-read (with includes).
        .mockResolvedValueOnce(
          finalizeRefund({ payment: codPayment, restock: false }) as never,
        )
        // 3) disburse final re-read.
        .mockResolvedValueOnce({
          id: 'refund-1',
          status: RefundStatus.PROCESSED,
        } as never);
      // 1st aggregate = over-refund re-check (no OTHER refunds → 0);
      // 2nd = finalize payment-level total (this refund PROCESSED → 100 → full).
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
    }

    it('finalizes a REQUESTED COD refund with no gateway call, records the UTR, and enqueues the buyer email', async () => {
      stubDisburse();

      await service.disburseManualRefund('admin-1', 'refund-1', 'UTR-99');

      // No gateway is ever contacted for a manual disbursement.
      expect(gateway.refund).not.toHaveBeenCalled();
      // The manual reference is persisted onto the refund before finalize.
      const upd = prisma.refund.update.mock.calls[0][0] as any;
      expect(upd.data.gatewayResponse.manual).toBe(true);
      expect(upd.data.gatewayResponse.reference).toBe('UTR-99');
      // Same guarded finalize: PROCESSED flip, Payment → REFUNDED, durable email.
      expect(prisma.refund.updateMany).toHaveBeenCalled();
      const payData = prisma.payment.update.mock.calls[0][0] as any;
      expect(payData.data.status).toBe(PaymentTransactionStatus.REFUNDED);
      expect(outbox.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ type: 'email.order_refunded' }),
      );
    });

    it('is idempotent — an already-PROCESSED refund is a no-op (no finalize, no gateway)', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.PROCESSED,
        payment: codPayment,
      } as never);

      const res = await service.disburseManualRefund(
        'admin-1',
        'refund-1',
        'UTR-99',
      );
      expect(res).toMatchObject({ id: 'refund-1' });
      expect(prisma.refund.update).not.toHaveBeenCalled();
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('refuses to manually disburse a gateway-backed refund', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.REQUESTED,
        amount: 100,
        payment: capturedPayment, // RAZORPAY with a gatewayPaymentId
      } as never);

      await expect(
        service.disburseManualRefund('admin-1', 'refund-1', 'UTR-99'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.refund.updateMany).not.toHaveBeenCalled();
    });

    it('requires a non-empty payment reference', async () => {
      await expect(
        service.disburseManualRefund('admin-1', 'refund-1', '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
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

  // ---------------------------------------------------------------------------
  // Seller-initiated cancellation refund
  // ---------------------------------------------------------------------------

  describe('seller-initiated cancellation refund', () => {
    const SELLER_ID = 'seller-1';
    const SELLER_USER_ID = 'seller-user-1';

    /**
     * A CANCELLED slice worth 60 on a captured payment of 100 — i.e. a
     * multi-seller order where this seller owns only part of the payment. The
     * gap between 60 and 100 is what the slice cap has to defend.
     */
    function stubSellerSlice(overrides: Record<string, unknown> = {}) {
      prisma.seller.findUnique.mockResolvedValue({ id: SELLER_ID } as never);
      prisma.sellerOrder.findUnique.mockResolvedValue({
        id: 'so-1',
        orderId: 'order-1',
        sellerId: SELLER_ID,
        storeId: 'store-1',
        orderNumber: 'SORD-1',
        currencyCode: 'INR',
        status: OrderStatus.CANCELLED,
        payoutStatus: PayoutStatus.PENDING,
        subtotal: 60,
        taxAmount: 0,
        shippingAmount: 0,
        discountAmount: 0,
        deletedAt: null,
        ...overrides,
      } as never);
      prisma.payment.findFirst.mockResolvedValue(capturedPayment as never);
      prisma.refund.aggregate.mockResolvedValue({
        _sum: { amount: 0 },
      } as never);
    }

    /** Short-circuits approveRefund via its already-PROCESSED idempotent branch. */
    function stubApproveIsNoop() {
      prisma.refund.create.mockResolvedValue({
        id: 'refund-1',
        amount: 60,
        reason: 'Order cancelled by seller',
      } as never);
      prisma.refund.findUnique.mockResolvedValue({
        id: 'refund-1',
        status: RefundStatus.PROCESSED,
        payment: capturedPayment,
      } as never);
    }

    it('refuses to refund a slice the caller does not own', async () => {
      stubSellerSlice({ sellerId: 'someone-else' });
      await expect(
        service.createSellerRefund(SELLER_USER_ID, { sellerOrderId: 'so-1' }),
      ).rejects.toThrow(/do not own/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('refuses when the caller is not a seller account', async () => {
      prisma.seller.findUnique.mockResolvedValue(null as never);
      await expect(
        service.createSellerRefund(USER_ID, { sellerOrderId: 'so-1' }),
      ).rejects.toThrow(/seller accounts/i);
    });

    it('refuses to refund an order that is not CANCELLED', async () => {
      stubSellerSlice({ status: OrderStatus.CONFIRMED });
      await expect(
        service.createSellerRefund(SELLER_USER_ID, { sellerOrderId: 'so-1' }),
      ).rejects.toThrow(/cancelled/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('refuses a COD order (no online payment was taken)', async () => {
      stubSellerSlice();
      prisma.payment.findFirst.mockResolvedValue({
        ...capturedPayment,
        gateway: PaymentGateway.COD,
        gatewayPaymentId: null,
      } as never);
      await expect(
        service.createSellerRefund(SELLER_USER_ID, { sellerOrderId: 'so-1' }),
      ).rejects.toThrow(/cash-on-delivery/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('refuses once the slice is in a payout run', async () => {
      stubSellerSlice({ payoutStatus: PayoutStatus.PAID });
      await expect(
        service.createSellerRefund(SELLER_USER_ID, { sellerOrderId: 'so-1' }),
      ).rejects.toThrow(/payout/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('caps the amount at the seller OWN slice, not the whole captured payment', async () => {
      stubSellerSlice(); // slice = 60, payment = 100
      // Asking for the full payment amount must be refused — 40 of it belongs
      // to another seller on the same order.
      await expect(
        service.createSellerRefund(SELLER_USER_ID, {
          sellerOrderId: 'so-1',
          amount: 100,
        }),
      ).rejects.toThrow(/exceeds the refundable amount/i);
      expect(prisma.refund.create).not.toHaveBeenCalled();
    });

    it('defaults the amount to the slice ceiling and never restocks (cancel already did)', async () => {
      stubSellerSlice();
      stubApproveIsNoop();

      await service.createSellerRefund(SELLER_USER_ID, {
        sellerOrderId: 'so-1',
      });

      expect(prisma.refund.create).toHaveBeenCalledTimes(1);
      const arg = prisma.refund.create.mock.calls[0][0] as any;
      expect(Number(arg.data.amount)).toBe(60); // slice total, not payment total
      expect(arg.data.sellerOrderId).toBe('so-1');
      expect(arg.data.requestedById).toBe(SELLER_USER_ID);
      expect(arg.data.status).toBe(RefundStatus.REQUESTED);
      // The double-restock guard: the cancel path already wrote `order_cancel`
      // movements, so this refund must NOT restock the same units again.
      expect(arg.data.restock).toBe(false);
    });

    it('accepts a seller-lowered partial amount', async () => {
      stubSellerSlice();
      stubApproveIsNoop();

      await service.createSellerRefund(SELLER_USER_ID, {
        sellerOrderId: 'so-1',
        amount: 25,
        reason: 'Partial — shipping already incurred',
      });

      const arg = prisma.refund.create.mock.calls[0][0] as any;
      expect(Number(arg.data.amount)).toBe(25);
      expect(arg.data.reason).toBe('Partial — shipping already incurred');
    });

    it('subtracts refunds already booked on the slice from the ceiling', async () => {
      stubSellerSlice();
      // 50 of the 60 slice is already refunded → only 10 left.
      prisma.refund.aggregate.mockResolvedValue({
        _sum: { amount: 50 },
      } as never);

      await expect(
        service.createSellerRefund(SELLER_USER_ID, {
          sellerOrderId: 'so-1',
          amount: 20,
        }),
      ).rejects.toThrow(/exceeds the refundable amount/i);
    });

    describe('preview', () => {
      it('reports a blockedReason instead of throwing when not refundable', async () => {
        stubSellerSlice({ status: OrderStatus.DELIVERED });
        prisma.refund.findMany.mockResolvedValue([] as never);

        const res = await service.getSellerRefundPreview(
          SELLER_USER_ID,
          'so-1',
        );
        expect(res.refundable).toBe(false);
        expect(res.blockedReason).toMatch(/cancelled/i);
      });

      it('returns the slice breakdown + ceiling for a refundable order', async () => {
        stubSellerSlice();
        prisma.refund.findMany.mockResolvedValue([] as never);

        const res = await service.getSellerRefundPreview(
          SELLER_USER_ID,
          'so-1',
        );
        expect(res).toMatchObject({
          refundable: true,
          blockedReason: null,
          sliceTotal: 60,
          alreadyRefunded: 0,
          maxRefundable: 60,
          paymentGateway: PaymentGateway.RAZORPAY,
        });
      });
    });
  });
});
