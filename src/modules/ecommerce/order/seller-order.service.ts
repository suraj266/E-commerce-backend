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
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PayoutStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { config } from '@/common/config/config';
import { UpdateSellerOrderStatusInput } from './dto/update-seller-order-status.input';
import { isValidTransition } from './order.helpers';
import { SELLER_ORDER_INCLUDE, hydrateSellerOrder } from './order.hydrate';
import { InvoiceService } from '../invoice/invoice.service';
import { TcsService } from '@/modules/compliance/tcs/tcs.service';
import { CourierService } from '../courier/courier.service';

const STATUS_TO_TEMPLATE: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: 'order_confirmed',
  SHIPPED: 'order_shipped',
  DELIVERED: 'order_delivered',
  CANCELLED: 'order_cancelled',
  REFUNDED: 'order_refunded',
};

// Statuses that count as "earned" revenue for a seller (mirrors the admin
// dashboard's REVENUE_STATUSES): the order is accepted and money is owed.
const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const changePct = (current: number, previous: number): number => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
};

@Injectable()
export class SellerOrderService {
  private readonly logger = new Logger(SellerOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly invoice: InvoiceService,
    @Inject(forwardRef(() => CourierService))
    private readonly courier: CourierService,
    // @Global TcsService (P3-03). Optional/guarded so the COD-confirm accrual is
    // a no-op wherever TcsModule isn't present (e.g. isolated unit contexts).
    private readonly tcs?: TcsService,
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

  /**
   * Admin lookup: returns any SellerOrder by id, regardless of seller.
   *
   * RBAC enforcement happens at the resolver via `@Permissions('invoice:manage')`.
   * Used by the admin invoice-management UI (T15) where staff need to
   * inspect a seller-order before regenerating its tax invoice.
   */
  async adminSellerOrder(sellerOrderId: string) {
    const row = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      include: SELLER_ORDER_INCLUDE,
    });
    if (!row || row.deletedAt) throw new NotFoundException('Order not found');
    return hydrateSellerOrder(row);
  }

  /**
   * Admin paginated list of SellerOrders. Supports an optional filter for
   * "has-invoice" / "no-invoice" so staff can audit the generation backlog.
   */
  async adminSellerOrdersWithInvoices(opts: {
    page?: number;
    pageSize?: number;
    onlyMissingInvoice?: boolean;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 20));

    const where: Prisma.SellerOrderWhereInput = {
      deletedAt: null,
      ...(opts.onlyMissingInvoice
        ? { invoiceUrl: null, paymentStatus: 'PAID' }
        : {}),
    };

    const [rows, totalCount] = await Promise.all([
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

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Seller-scoped earnings + sales analytics for the dashboard. Aggregates the
   * seller's own SellerOrders: net earnings (payout after commission), gross
   * sales, commission, payout status, order pipeline counts, a 12-month
   * earnings series, and best-sellers over the last 30 days.
   */
  async getMyStats(userId: string) {
    const sellerId = await this.getSellerId(userId);

    const now = new Date();
    const currStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd = currStart;
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const revenueWhere: Prisma.SellerOrderWhereInput = {
      sellerId,
      deletedAt: null,
      status: { in: REVENUE_STATUSES },
    };

    const [
      netThisMonth,
      netLastMonth,
      lifetimeAgg,
      grossThisMonth,
      pendingPayout,
      paidPayout,
      ordersThisMonth,
      ordersLastMonth,
      lifetimeOrders,
      statusGroups,
      monthlyRows,
      bestSellerItems,
    ] = await Promise.all([
      this.prisma.sellerOrder.aggregate({
        _sum: { payoutAmount: true },
        where: { ...revenueWhere, createdAt: { gte: currStart, lt: currEnd } },
      }),
      this.prisma.sellerOrder.aggregate({
        _sum: { payoutAmount: true },
        where: { ...revenueWhere, createdAt: { gte: prevStart, lt: prevEnd } },
      }),
      this.prisma.sellerOrder.aggregate({
        _sum: { payoutAmount: true, commissionAmount: true, subtotal: true },
        _count: { _all: true },
        where: revenueWhere,
      }),
      this.prisma.sellerOrder.aggregate({
        _sum: { subtotal: true },
        where: { ...revenueWhere, createdAt: { gte: currStart, lt: currEnd } },
      }),
      this.prisma.sellerOrder.aggregate({
        _sum: { payoutAmount: true },
        where: { ...revenueWhere, payoutStatus: PayoutStatus.PENDING },
      }),
      this.prisma.sellerOrder.aggregate({
        _sum: { payoutAmount: true },
        where: { sellerId, deletedAt: null, payoutStatus: PayoutStatus.PAID },
      }),
      this.prisma.sellerOrder.count({
        where: {
          sellerId,
          deletedAt: null,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: currStart, lt: currEnd },
        },
      }),
      this.prisma.sellerOrder.count({
        where: {
          sellerId,
          deletedAt: null,
          status: { not: OrderStatus.CANCELLED },
          createdAt: { gte: prevStart, lt: prevEnd },
        },
      }),
      this.prisma.sellerOrder.count({
        where: {
          sellerId,
          deletedAt: null,
          status: { not: OrderStatus.CANCELLED },
        },
      }),
      this.prisma.sellerOrder.groupBy({
        by: ['status'],
        where: { sellerId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.sellerOrder.findMany({
        where: { ...revenueWhere, createdAt: { gte: yearStart } },
        select: { createdAt: true, payoutAmount: true },
      }),
      this.prisma.orderItem.findMany({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          sellerOrder: {
            sellerId,
            deletedAt: null,
            status: { in: REVENUE_STATUSES },
          },
        },
        select: {
          productId: true,
          name: true,
          quantity: true,
          totalPrice: true,
        },
      }),
    ]);

    // 12-month net-earnings buckets for the current calendar year.
    const monthlyEarnings = MONTH_LABELS.map((m) => ({ label: m, value: 0 }));
    for (const r of monthlyRows) {
      monthlyEarnings[r.createdAt.getMonth()].value += Number(r.payoutAmount);
    }

    // Pipeline counts by status.
    const countOf = (s: OrderStatus) =>
      statusGroups.find((g) => g.status === s)?._count._all ?? 0;
    const toShipOrders =
      countOf(OrderStatus.CONFIRMED) + countOf(OrderStatus.PACKED);

    // Best sellers — aggregate snapshotted item rows by product in JS.
    const bestMap = new Map<
      string,
      { name: string; unitsSold: number; revenue: number }
    >();
    for (const it of bestSellerItems) {
      const prev = bestMap.get(it.productId) ?? {
        name: it.name,
        unitsSold: 0,
        revenue: 0,
      };
      prev.name = it.name;
      prev.unitsSold += it.quantity;
      prev.revenue += Number(it.totalPrice);
      bestMap.set(it.productId, prev);
    }
    const bestSellers = [...bestMap.entries()]
      .map(([productId, v]) => ({ productId, ...v }))
      .sort((a, b) => b.unitsSold - a.unitsSold)
      .slice(0, 5);

    const netThis = Number(netThisMonth._sum.payoutAmount ?? 0);
    const netLast = Number(netLastMonth._sum.payoutAmount ?? 0);
    const lifetimeGross = Number(lifetimeAgg._sum.subtotal ?? 0);
    const lifetimeCount = lifetimeAgg._count._all ?? 0;

    return {
      netEarningsThisMonth: netThis,
      netEarningsLastMonth: netLast,
      netEarningsChangePct: changePct(netThis, netLast),
      lifetimeNetEarnings: Number(lifetimeAgg._sum.payoutAmount ?? 0),
      grossSalesThisMonth: Number(grossThisMonth._sum.subtotal ?? 0),
      lifetimeCommission: Number(lifetimeAgg._sum.commissionAmount ?? 0),
      pendingPayoutAmount: Number(pendingPayout._sum.payoutAmount ?? 0),
      paidPayoutAmount: Number(paidPayout._sum.payoutAmount ?? 0),
      ordersThisMonth,
      ordersLastMonth,
      ordersChangePct: changePct(ordersThisMonth, ordersLastMonth),
      lifetimeOrders,
      avgOrderValue: lifetimeCount > 0 ? lifetimeGross / lifetimeCount : 0,
      pendingOrders: countOf(OrderStatus.PENDING),
      toShipOrders,
      deliveredOrders: countOf(OrderStatus.DELIVERED),
      cancelledOrders: countOf(OrderStatus.CANCELLED),
      monthlyEarnings,
      bestSellers,
    };
  }

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  async updateStatus(userId: string, input: UpdateSellerOrderStatusInput) {
    const sellerId = await this.getSellerId(userId);
    const existing = await this.prisma.sellerOrder.findUnique({
      where: { id: input.sellerOrderId },
      include: {
        order: { select: { paymentMethod: true, paymentStatus: true } },
      },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Order not found');
    }
    if (existing.sellerId !== sellerId) {
      throw new ForbiddenException('You do not own this order.');
    }
    // Prepaid payment guard: an order paid via a gateway must have its payment
    // CAPTURED before the seller can move it forward. The ONLY action allowed
    // on an unpaid prepaid order is cancellation. COD is exempt (paid on
    // delivery). This blocks fulfilling an order whose payment was cancelled or
    // failed — and is the source of truth even if the UI doesn't hide buttons.
    if (
      input.status !== OrderStatus.CANCELLED &&
      existing.order.paymentMethod !== PaymentMethod.COD &&
      existing.order.paymentStatus !== PaymentStatus.PAID
    ) {
      throw new BadRequestException(
        'Payment is not confirmed for this prepaid order — you cannot proceed until the payment is captured.',
      );
    }
    if (!isValidTransition(existing.status, input.status)) {
      throw new BadRequestException(
        `Cannot transition from ${existing.status} to ${input.status}.`,
      );
    }
    // Capture the pre-transition state so we can fire the COD invoice
    // trigger AFTER the transaction commits. We deliberately read this
    // here rather than inside the closure so the trigger only fires
    // when the seller actually accepted (PENDING → CONFIRMED), not on
    // arbitrary subsequent edits.
    const isCodConfirmation =
      existing.status === OrderStatus.PENDING &&
      input.status === OrderStatus.CONFIRMED &&
      !existing.invoiceUrl;
    // Any PENDING→CONFIRMED pushes the order to the seller's courier dashboard
    // (two-phase: "New Order" now, courier/AWB chosen later at ship time).
    const isConfirmation =
      existing.status === OrderStatus.PENDING && input.status === OrderStatus.CONFIRMED;

    const now = new Date();
    const stampPatch: Prisma.SellerOrderUpdateInput = { status: input.status };
    if (input.status === OrderStatus.PACKED) stampPatch.packedAt = now;
    if (input.status === OrderStatus.SHIPPED) {
      // In-house v1: the seller types the courier + tracking number when they
      // hand the parcel over. Required so the customer gets a usable "track
      // shipment" link instead of the old hardcoded "Pending".
      if (!input.trackingNumber || !input.trackingNumber.trim()) {
        throw new BadRequestException(
          'A tracking number is required to mark the order as shipped.',
        );
      }
      stampPatch.shippedAt = now;
      stampPatch.dispatchedAt = now;
      stampPatch.trackingNumber = input.trackingNumber.trim();
      if (input.carrier) stampPatch.carrier = input.carrier.trim();
      if (input.trackingUrl) stampPatch.trackingUrl = input.trackingUrl.trim();
      if (input.expectedDeliveryAt) stampPatch.expectedDeliveryAt = input.expectedDeliveryAt;
    }
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

      // COD confirmation is the taxable event for a COD seller-order (the tax
      // invoice also generates on confirm, below). Accrue marketplace TCS §52
      // INSIDE this tx so the ledger row commits atomically with the CONFIRMED
      // flip. Idempotent (unique per seller-order) — safe under retries.
      if (isCodConfirmation) {
        await this.tcs?.accrue(tx, existing.id);
      }

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

    // COD flow: invoice generates when the seller actually confirms (and
    // accepts) the order. Online payments fire the invoice in
    // PaymentService.verifyPayment / webhook captured branch.
    if (isCodConfirmation) {
      this.invoice.generateForSellerOrder(existing.id).catch((err) =>
        this.logger.warn(
          `Invoice generation failed on COD confirm for ${existing.id}: ${(err as Error).message}`,
        ),
      );
    }

    // Push to the courier dashboard on confirm (fire-and-forget; never throws).
    if (isConfirmation) {
      void this.courier.createOrderAtConfirm(existing.id);
    }

    return hydrateSellerOrder(fresh);
  }

  /**
   * Courier-driven SHIPPED transition. Reuses `updateStatus` (inventory commit +
   * order_shipped email + history; the AWB satisfies the mandatory tracking
   * number), then stamps the courier-specific fields the manual path lacks.
   */
  async markShippedFromCourier(
    userId: string,
    sellerOrderId: string,
    patch: {
      awbCode: string;
      courierName: string;
      trackingUrl?: string | null;
      labelUrl?: string | null;
      shipmentId?: string | null;
      providerOrderId?: string | null;
      shippingProvider?: 'SHIPROCKET' | 'MOCK' | null;
      expectedDeliveryAt?: Date | null;
    },
  ) {
    await this.updateStatus(userId, {
      sellerOrderId,
      status: OrderStatus.SHIPPED,
      trackingNumber: patch.awbCode,
      carrier: patch.courierName,
      trackingUrl: patch.trackingUrl ?? undefined,
      expectedDeliveryAt: patch.expectedDeliveryAt ?? undefined,
    });
    const fresh = await this.prisma.sellerOrder.update({
      where: { id: sellerOrderId },
      data: {
        awbCode: patch.awbCode,
        shipmentId: patch.shipmentId ?? undefined,
        providerOrderId: patch.providerOrderId ?? undefined,
        labelUrl: patch.labelUrl ?? undefined,
        shippingProvider: patch.shippingProvider ?? undefined,
      },
      include: SELLER_ORDER_INCLUDE,
    });
    return hydrateSellerOrder(fresh);
  }

  /**
   * System-driven status update from a courier webhook / tracking poll (no
   * seller actor). Applies only forward, valid transitions; DELIVERED rolls the
   * parent up + emails like the seller path. NDR/RTO are NOT status changes
   * (SHIPPED→CANCELLED is forbidden) — they're recorded as metadata flags +
   * a history note + an alert email for human resolution.
   */
  async applyCourierStatus(
    sellerOrderId: string,
    target: OrderStatus | 'NDR' | 'RTO',
    note: string,
  ): Promise<void> {
    const so = await this.prisma.sellerOrder.findUnique({ where: { id: sellerOrderId } });
    if (!so || so.deletedAt) return;

    if (target === 'NDR' || target === 'RTO') {
      const meta = (typeof so.metadata === 'object' && so.metadata) ? (so.metadata as Record<string, unknown>) : {};
      const nextMeta = {
        ...meta,
        [target.toLowerCase()]: true,
        [`${target.toLowerCase()}At`]: new Date().toISOString(),
      } as Prisma.InputJsonValue;
      await this.prisma.sellerOrder.update({
        where: { id: so.id },
        data: { metadata: nextMeta },
      });
      await this.prisma.orderStatusHistory.create({
        data: { sellerOrderId: so.id, fromStatus: so.status, toStatus: so.status, notes: `Courier: ${note}` },
      });
      return;
    }

    if (so.status === target || !isValidTransition(so.status, target)) return;

    const now = new Date();
    const stamp: Prisma.SellerOrderUpdateInput = { status: target };
    if (target === OrderStatus.SHIPPED) stamp.shippedAt = so.shippedAt ?? now;
    if (target === OrderStatus.DELIVERED) stamp.deliveredAt = now;

    await this.prisma.$transaction(async (tx) => {
      await tx.sellerOrder.update({ where: { id: so.id }, data: stamp });
      await tx.orderStatusHistory.create({
        data: { sellerOrderId: so.id, fromStatus: so.status, toStatus: target, notes: `Courier: ${note}` },
      });
      if (target === OrderStatus.DELIVERED) {
        const siblings = await tx.sellerOrder.findMany({
          where: { orderId: so.orderId },
          select: { status: true },
        });
        if (siblings.every((s) => s.status === OrderStatus.DELIVERED)) {
          await tx.order.update({
            where: { id: so.orderId },
            data: { deliveredAt: now, status: OrderStatus.DELIVERED },
          });
        }
      }
    });

    this.dispatchStatusEmail(so.id, target, note).catch((err) =>
      this.logger.warn(`Courier status email failed for ${so.id}: ${(err as Error).message}`),
    );
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
      // Real tracking captured when the seller marked the order shipped.
      trackingNumber: so.trackingNumber ?? 'Pending',
      carrier: so.carrier ?? '',
      trackingLink: so.trackingUrl ?? `${frontendUrl}/account/orders/${so.orderId}`,
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
