/**
 * SellerOrderService — seller-facing operations on their own SellerOrders.
 *
 *   - mySellerOrders            paginated list of the seller's sub-orders
 *   - mySellerOrder             detail by id (ownership-checked)
 *   - updateSellerOrderStatus   transition a sub-order forward in the
 *                               status workflow (validated against
 *                               isValidTransition rules in order.helpers)
 *
 * Status transitions are stored as OrderStatusHistory rows for audit.
 * Sellers cannot edit financials (totals, commission) — those are
 * frozen at placement time.
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
import { UpdateSellerOrderStatusInput } from './dto/update-seller-order-status.input';
import { isValidTransition } from './order.helpers';
import { SELLER_ORDER_INCLUDE, hydrateSellerOrder } from './order.hydrate';

const STATUS_TO_TEMPLATE: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'order_confirmed',
  SHIPPED: 'order_shipped',
  DELIVERED: 'order_delivered',
  CANCELLED: 'order_cancelled',
  REFUNDED: 'order_refunded',
};

@Injectable()
export class SellerOrderService {
  private readonly logger = new Logger(SellerOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Identity helper
  // ---------------------------------------------------------------------------

  private async getSellerId(userId: string): Promise<string> {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!seller) {
      throw new ForbiddenException('Seller orders are only available to seller accounts.');
    }
    if (seller.deletedAt) {
      throw new ForbiddenException('Your seller account has been archived.');
    }
    return seller.id;
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async mySellerOrders(
    userId: string,
    opts: { status?: OrderStatus; page?: number; pageSize?: number },
  ) {
    const sellerId = await this.getSellerId(userId);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 20));

    const where: Prisma.SellerOrderWhereInput = {
      sellerId,
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
    };

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.sellerOrder.findMany({
        where,
        include: SELLER_ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.sellerOrder.count({ where }),
    ]);

    return {
      items: rows.map(hydrateSellerOrder),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  async mySellerOrder(userId: string, sellerOrderId: string) {
    const sellerId = await this.getSellerId(userId);
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      include: SELLER_ORDER_INCLUDE,
    });
    if (!row || row.deletedAt) throw new NotFoundException('Order not found');
    if (row.sellerId !== sellerId) {
      throw new ForbiddenException('You do not own this order.');
    }
    return hydrateSellerOrder(row);
  }

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  async updateStatus(userId: string, input: UpdateSellerOrderStatusInput) {
    const sellerId = await this.getSellerId(userId);
    const existing = await this.prisma.sellerOrder.findUnique({
      where: { id: input.sellerOrderId },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Order not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenException('You do not own this order.');
    }
    if (!isValidTransition(existing.status, input.status)) {
      throw new BadRequestException(
        `Cannot transition from ${existing.status} to ${input.status}.`,
      );
    }

    const now = new Date();
    const stampPatch: Prisma.SellerOrderUpdateInput = { status: input.status };
    if (input.status === OrderStatus.PACKED) stampPatch.packedAt = now;
    if (input.status === OrderStatus.SHIPPED) stampPatch.shippedAt = now;
    if (input.status === OrderStatus.DELIVERED) stampPatch.deliveredAt = now;
    if (input.status === OrderStatus.CANCELLED) stampPatch.cancelledAt = now;

    await this.prisma.$transaction(async (tx) => {
      await tx.sellerOrder.update({
        where: { id: existing.id },
        data: stampPatch,
      });
      await tx.orderStatusHistory.create({
        data: {
          sellerOrderId: existing.id,
          fromStatus: existing.status,
          toStatus: input.status,
          changedById: userId,
          notes: input.notes ?? null,
        },
      });

      // When sub-order transitions to DELIVERED, if every sibling is also
      // delivered, stamp the parent Order's deliveredAt for analytics.
      if (input.status === OrderStatus.DELIVERED) {
        const siblings = await tx.sellerOrder.findMany({
          where: { orderId: existing.orderId },
          select: { status: true },
        });
        const allDelivered = siblings.every(
          (s) => s.status === OrderStatus.DELIVERED,
        );
        if (allDelivered) {
          await tx.order.update({
            where: { id: existing.orderId },
            data: { deliveredAt: now, status: OrderStatus.DELIVERED },
          });
          await tx.orderStatusHistory.create({
            data: {
              orderId: existing.orderId,
              toStatus: OrderStatus.DELIVERED,
              changedById: userId,
              notes: 'All sub-orders delivered',
            },
          });
        }
      }

      // Shipment commit: stock physically leaves the warehouse. Decrement
      // quantityOnHand AND quantityReserved by the same amount; leave
      // quantityAvailable alone (it was already debited at placement, when
      // the reservation moved available → reserved).
      //
      // We scope by warehouseId belonging to THIS seller's store, not just
      // by variantId, so a parent order that contains the same variant from
      // a different seller does not get its stock committed here.
      if (input.status === OrderStatus.SHIPPED) {
        const items = await tx.orderItem.findMany({
          where: { sellerOrderId: existing.id },
          select: { variantId: true },
        });
        const variantIds = items.map((i) => i.variantId);

        const movements = await tx.inventoryMovement.findMany({
          where: {
            referenceType: 'order',
            referenceId: existing.orderId,
            variantId: { in: variantIds },
            warehouse: { storeId: existing.storeId },
          },
        });

        for (const m of movements) {
          const shipQty = Math.abs(m.quantityChange);
          const before = await tx.inventory.findUnique({
            where: { id: m.inventoryId },
            select: { quantityOnHand: true },
          });
          if (!before) continue;

          const inv = await tx.inventory.update({
            where: { id: m.inventoryId },
            data: {
              quantityOnHand: { decrement: shipQty },
              quantityReserved: { decrement: shipQty },
              // quantityAvailable: untouched on purpose.
            },
          });
          await tx.inventoryMovement.create({
            data: {
              inventoryId: m.inventoryId,
              variantId: m.variantId,
              warehouseId: m.warehouseId,
              movementType: 'sale',
              quantityChange: -shipQty,
              quantityBefore: before.quantityOnHand,
              quantityAfter: inv.quantityOnHand,
              referenceType: 'order_ship',
              referenceId: existing.id,
              createdById: userId,
              notes: `Shipped ${existing.orderNumber}`,
            },
          });
        }
      }

      // Cancellation in this path: seller-driven on a still-PENDING or
      // CONFIRMED sub-order. Release the reserved inventory for THIS
      // sub-order's items only (cancelling one seller's slice doesn't
      // touch other sellers' reservations).
      if (input.status === OrderStatus.CANCELLED) {
        const items = await tx.orderItem.findMany({
          where: { sellerOrderId: existing.id },
          select: { variantId: true, quantity: true },
        });
        const movements = await tx.inventoryMovement.findMany({
          where: {
            referenceType: 'order',
            referenceId: existing.orderId,
            variantId: { in: items.map((i) => i.variantId) },
            // Same defensive scope as the SHIPPED branch — don't restore
            // stock that belongs to a different seller selling the same
            // variant from a different warehouse.
            warehouse: { storeId: existing.storeId },
          },
        });
        for (const m of movements) {
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
              referenceId: existing.orderId,
              createdById: userId,
              notes: 'Seller cancellation',
            },
          });
        }
      }
    });

    const fresh = await this.prisma.sellerOrder.findUnique({
      where: { id: existing.id },
      include: SELLER_ORDER_INCLUDE,
    });

    // Post-transition customer email — fire-and-forget, soft-fail.
    this.dispatchStatusEmail(existing.id, input.status, input.notes).catch(
      (err) =>
        this.logger.warn(
          `Status email failed for ${existing.id}: ${(err as Error).message}`,
        ),
    );

    return hydrateSellerOrder(fresh);
  }

  // ---------------------------------------------------------------------------
  // Customer-facing status emails
  // ---------------------------------------------------------------------------

  /**
   * Sends the appropriate template to the customer when their seller-order
   * slice transitions. Maps OrderStatus → template key via STATUS_TO_TEMPLATE.
   * No-op when the new status doesn't have a template (e.g. PACKED is an
   * internal-only state).
   */
  private async dispatchStatusEmail(
    sellerOrderId: string,
    newStatus: OrderStatus,
    notes: string | null | undefined,
  ): Promise<void> {
    const templateKey = STATUS_TO_TEMPLATE[newStatus];
    if (!templateKey) return;

    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      include: {
        order: {
          include: { customer: { include: { user: true } } },
        },
        store: { include: { seller: true } },
      },
    });
    const customerEmail = so?.order?.customer?.user?.email;
    if (!so || !customerEmail) return;

    const customerName = so.order.customer.user.name ?? 'there';
    const sellerName =
      so.store?.seller?.displayName ?? so.store?.name ?? 'the seller';
    const frontendUrl = config.FRONTEND_URL ?? '';

    await this.email.send(templateKey, customerEmail, {
      customerName,
      sellerName,
      orderNumber: so.orderNumber,
      orderLink: `${frontendUrl}/account/orders/${so.orderId}`,
      // Status-specific values — extras are simply ignored by templates that
      // don't reference them.
      cancellationReason: notes ?? 'No reason provided.',
      refundAmount: formatRupees(Number(so.subtotal)),
      // Tracking fields are TODO once shipping integration lands.
      trackingNumber: 'Pending',
      trackingLink: `${frontendUrl}/account/orders/${so.orderId}`,
      shopName: 'Trueway',
    });
  }
}

function formatRupees(amount: number): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }
}
