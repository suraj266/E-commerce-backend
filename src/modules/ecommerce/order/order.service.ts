/**
 * OrderService — customer-facing order operations.
 *
 *   - myOrders           paginated list of the customer's orders
 *   - myOrder            detail by id (ownership-checked)
 *   - cancelMyOrder      customer cancels their own pending order
 *   - placeOrder         delegates to OrderPlacementService
 *
 * Seller-side operations live in `seller-order.service.ts`. Admin order
 * oversight isn't built in Phase 5 — it's a separate sprint when we hit
 * that need.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { config } from '@/common/config/config';
import { OrderPlacementService } from './order-placement.service';
import { PlaceOrderInput } from './dto/place-order.input';
import { ORDER_INCLUDE, hydrateOrder } from './order.hydrate';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly placement: OrderPlacementService,
    private readonly email: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Identity helper — matches the pattern used in cart/wishlist
  // ---------------------------------------------------------------------------

  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!customer) {
      throw new ForbiddenException('Orders are only available to customer accounts.');
    }
    if (customer.deletedAt) {
      throw new ForbiddenException('This account has been archived.');
    }
    return customer.id;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async myOrders(
    userId: string,
    opts: { status?: OrderStatus; page?: number; pageSize?: number },
  ) {
    const customerId = await this.getCustomerId(userId);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 10));

    const where: Prisma.OrderWhereInput = {
      customerId,
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
    };

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { placedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: rows.map(hydrateOrder),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  async myOrder(userId: string, orderId: string) {
    const customerId = await this.getCustomerId(userId);
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!row || row.deletedAt) throw new NotFoundException('Order not found');
    if (row.customerId !== customerId) {
      throw new ForbiddenException('You do not own this order.');
    }
    return hydrateOrder(row);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  placeOrder(userId: string, input: PlaceOrderInput) {
    return this.placement.placeOrder(userId, input);
  }

  /**
   * Customer-driven cancel. Allowed only while the order is still PENDING
   * across ALL sub-orders. Once any seller has confirmed/packed, the
   * customer must contact support — we don't want to silently undo
   * inventory that's already been allocated by a seller's warehouse.
   *
   * The cancel cascades:
   *   - Each SellerOrder transitions to CANCELLED with a history entry
   *   - Parent Order transitions to CANCELLED
   *   - Inventory reservations are released back to qtyAvailable
   *   - InventoryMovement records the release
   */
  async cancelMyOrder(userId: string, orderId: string, notes?: string) {
    const customerId = await this.getCustomerId(userId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { sellerOrders: { include: { items: true } } },
    });
    if (!order || order.deletedAt) {
      throw new NotFoundException('Order not found');
    }
    if (order.customerId !== customerId) {
      throw new ForbiddenException('You do not own this order.');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        'This order can no longer be cancelled by you. Please contact support.',
      );
    }
    if (
      order.sellerOrders.some(
        (so) =>
          so.status !== OrderStatus.PENDING && so.status !== OrderStatus.CANCELLED,
      )
    ) {
      throw new BadRequestException(
        'A seller has started fulfilling this order. Cancel via support.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Cancel each SellerOrder (idempotent — skip already-cancelled).
      for (const so of order.sellerOrders) {
        if (so.status === OrderStatus.CANCELLED) continue;
        await tx.sellerOrder.update({
          where: { id: so.id },
          data: { status: OrderStatus.CANCELLED, cancelledAt: now },
        });
        await tx.orderStatusHistory.create({
          data: {
            sellerOrderId: so.id,
            fromStatus: so.status,
            toStatus: OrderStatus.CANCELLED,
            changedById: userId,
            notes: notes ?? 'Cancelled by customer',
          },
        });
      }

      // Cancel parent.
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED, cancelledAt: now },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: OrderStatus.CANCELLED,
          changedById: userId,
          notes: notes ?? 'Cancelled by customer',
        },
      });

      // Release inventory: revert qtyReserved → qtyAvailable for every
      // movement we wrote at placement. Reading the original movements
      // tells us exactly which warehouse received which deductions.
      const movements = await tx.inventoryMovement.findMany({
        where: { referenceType: 'order', referenceId: orderId },
      });
      for (const m of movements) {
        // Original deduction was `quantityChange` (negative). Reverse it.
        const restore = Math.abs(m.quantityChange);
        const inv = await tx.inventory.update({
          where: { id: m.inventoryId },
          data: {
            quantityAvailable: { increment: restore },
            quantityReserved: { decrement: restore },
          },
        });
        await tx.inventoryMovement.create({
          data: {
            inventoryId: m.inventoryId,
            variantId: m.variantId,
            warehouseId: m.warehouseId,
            movementType: 'return',
            quantityChange: restore,
            quantityBefore: inv.quantityAvailable - restore,
            quantityAfter: inv.quantityAvailable,
            referenceType: 'order_cancel',
            referenceId: orderId,
            createdById: userId,
            notes: `Released from ${order.orderNumber}`,
          },
        });
      }
    });

    const fresh = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });

    this.dispatchCancelEmail(orderId, notes).catch((err) =>
      this.logger.warn(
        `Cancel email failed for ${orderId}: ${(err as Error).message}`,
      ),
    );

    return hydrateOrder(fresh);
  }

  /**
   * Confirms to the customer that their cancellation request was processed.
   * Soft-fails — the cancel itself is already committed so a missed email is
   * a tolerable degradation.
   */
  private async dispatchCancelEmail(orderId: string, notes?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: { include: { user: true } } },
    });
    const customerEmail = order?.customer?.user?.email;
    if (!order || !customerEmail) return;

    await this.email.send('order_cancelled', customerEmail, {
      customerName: order.customer.user.name ?? 'there',
      orderNumber: order.orderNumber,
      cancellationReason: notes ?? 'Cancelled at your request.',
      orderLink: `${config.FRONTEND_URL ?? ''}/account/orders/${order.id}`,
      shopName: 'Trueway',
    });
  }
}
