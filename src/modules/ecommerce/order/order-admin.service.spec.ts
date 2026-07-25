import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { BadRequestException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { OrderService } from './order.service';
import { OrderAdminService } from './order-admin.service';

/**
 * OrderAdminService.adminCancelOrder fulfilment guard (Wave-4 review #2): the
 * plain-cancel path restocks reservations + voids the amount owed, so it must
 * refuse any order already in fulfilment — including a COD order that keeps
 * paymentStatus=PENDING through DELIVERED.
 */
describe('OrderAdminService.adminCancelOrder — fulfilment guard', () => {
  let service: OrderAdminService;
  let prisma: DeepMockProxy<PrismaService>;
  let orderService: DeepMockProxy<OrderService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    orderService = mockDeep<OrderService>();
    service = new OrderAdminService(
      prisma as unknown as PrismaService,
      orderService as unknown as OrderService,
    );
  });

  it('refuses to cancel a DELIVERED COD order (paymentStatus still PENDING)', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.DELIVERED,
      paymentStatus: PaymentStatus.PENDING, // COD — never flips to PAID pre-delivery
      deletedAt: null,
      sellerOrders: [{ status: OrderStatus.DELIVERED }],
    } as never);

    await expect(
      service.adminCancelOrder('admin-1', 'order-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The restock/void cancel path must NOT run for a delivered order.
    expect(orderService.cancelForPaymentFailure).not.toHaveBeenCalled();
  });

  it('refuses when any seller order has shipped, even if the parent looks CONFIRMED', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-2',
      status: OrderStatus.CONFIRMED,
      paymentStatus: PaymentStatus.PENDING,
      deletedAt: null,
      sellerOrders: [
        { status: OrderStatus.CONFIRMED },
        { status: OrderStatus.SHIPPED },
      ],
    } as never);

    await expect(
      service.adminCancelOrder('admin-1', 'order-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orderService.cancelForPaymentFailure).not.toHaveBeenCalled();
  });

  it('allows cancelling a still-PENDING unpaid order', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-3',
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      deletedAt: null,
      sellerOrders: [{ status: OrderStatus.PENDING }],
    } as never);
    orderService.cancelForPaymentFailure.mockResolvedValue({
      id: 'order-3',
    } as never);

    await service.adminCancelOrder('admin-1', 'order-3', 'fraud');
    expect(orderService.cancelForPaymentFailure).toHaveBeenCalledTimes(1);
  });
});
