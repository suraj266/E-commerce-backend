/**
 * OrderAdminService — cross-seller admin oversight of parent Orders (Phase 3
 * Wave 4).
 *
 * Read surface:
 *   - adminOrders   paginated cross-seller parent-order list with status /
 *                   payment / seller / date-range / free-text filters
 *   - adminOrder    parent-order detail by id (no ownership check — admin)
 *
 * Write surface (deliberately thin — NO bespoke money logic):
 *   - adminCancelOrder   reuses the EXISTING cancellation service path
 *                        (OrderService.cancelForPaymentFailure), which already
 *                        cascades SellerOrders → CANCELLED and releases the
 *                        reserved inventory exactly like the customer/system
 *                        cancels. A PAID order is intentionally refused here and
 *                        routed to the refund console (RefundService.approveRefund
 *                        is the money-mover that cancels + refunds + restocks a
 *                        captured order).
 *
 * RBAC is enforced at the resolver: reads gate on `order:read`, the cancel on
 * `order:manage`.
 */

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/modules/observability/audit/audit.service';
import { OrderService } from './order.service';
import { ORDER_INCLUDE, hydrateOrder } from './order.hydrate';

export interface AdminOrdersFilter {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  sellerId?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
}

/** Payment states where money has already moved — a plain cancel is unsafe. */
const PAID_STATES: PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

@Injectable()
export class OrderAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderService: OrderService,
    // @Global AuditService (P3-05). Optional/guarded so unit contexts that
    // construct this service directly don't need to wire it; the app always
    // injects it. record() never throws.
    private readonly audit?: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async adminOrders(opts: AdminOrdersFilter) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));

    // status / sellerId narrow to parent orders that HAVE a matching sub-order
    // (a parent is cross-seller, so we can't filter on a single column).
    const subOrderSome: Prisma.SellerOrderWhereInput = {
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.sellerId ? { sellerId: opts.sellerId } : {}),
    };
    const hasSubFilter = !!(opts.status || opts.sellerId);

    const search = opts.search?.trim();
    const dateFilter: Prisma.DateTimeFilter = {};
    if (opts.dateFrom) dateFilter.gte = opts.dateFrom;
    if (opts.dateTo) dateFilter.lte = opts.dateTo;

    const where: Prisma.OrderWhereInput = {
      deletedAt: null,
      ...(opts.paymentStatus ? { paymentStatus: opts.paymentStatus } : {}),
      ...(opts.dateFrom || opts.dateTo ? { placedAt: dateFilter } : {}),
      ...(hasSubFilter ? { sellerOrders: { some: subOrderSome } } : {}),
      ...(search
        ? {
            OR: [
              { orderNumber: { contains: search, mode: 'insensitive' } },
              {
                customer: {
                  user: {
                    OR: [
                      { name: { contains: search, mode: 'insensitive' } },
                      { email: { contains: search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
              {
                sellerOrders: {
                  some: {
                    OR: [
                      {
                        orderNumber: { contains: search, mode: 'insensitive' },
                      },
                      { store: { name: { contains: search, mode: 'insensitive' } } },
                      {
                        seller: {
                          displayName: { contains: search, mode: 'insensitive' },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
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

  async adminOrder(orderId: string) {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    if (!row || row.deletedAt) throw new NotFoundException('Order not found');
    return hydrateOrder(row);
  }

  // ---------------------------------------------------------------------------
  // Guarded admin action — cancel via the EXISTING cancellation path
  // ---------------------------------------------------------------------------

  /**
   * Admin cancel of a not-yet-paid order. Delegates to the existing
   * `OrderService.cancelForPaymentFailure` so the restock cascade and status
   * flips stay identical to every other cancel (no duplicated money logic).
   * Idempotent (a CANCELLED order is returned untouched). A captured/paid order
   * is refused — those must be cancelled + refunded through the refund console.
   */
  async adminCancelOrder(actorUserId: string, orderId: string, reason?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        deletedAt: true,
        sellerOrders: { select: { status: true } },
      },
    });
    if (!order || order.deletedAt) throw new NotFoundException('Order not found');

    // Idempotent: already cancelled → return current hydrated order.
    if (order.status === OrderStatus.CANCELLED) {
      return this.adminOrder(orderId);
    }

    if (PAID_STATES.includes(order.paymentStatus)) {
      throw new BadRequestException(
        'This order has a captured payment. Cancel and refund it from the Refunds console so the buyer is refunded and stock is restocked.',
      );
    }

    // FULFILLMENT guard (review #2): the reuse path (cancelForPaymentFailure)
    // restocks placement reservations and voids the amount owed — only valid
    // BEFORE fulfilment. A COD order keeps paymentStatus=PENDING right through
    // DELIVERED, so the PAID_STATES check alone would let a shipped/delivered COD
    // order be cancelled — restocking goods that already left the warehouse and
    // erasing a real sale. Only PENDING/CONFIRMED (nothing packed/shipped) may be
    // plain-cancelled; anything in fulfilment goes through the returns/refund flow.
    const CANCELLABLE: OrderStatus[] = [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
    ];
    const anyFulfilling = order.sellerOrders.some(
      (so) =>
        so.status === OrderStatus.PACKED ||
        so.status === OrderStatus.SHIPPED ||
        so.status === OrderStatus.DELIVERED,
    );
    if (!CANCELLABLE.includes(order.status) || anyFulfilling) {
      throw new BadRequestException(
        'This order is already in fulfilment (packed/shipped/delivered) and cannot be plain-cancelled. Use the Returns/Refunds console.',
      );
    }

    const note = reason?.trim()
      ? `Admin cancellation: ${reason.trim()}`
      : 'Cancelled by admin';

    const result = await this.orderService.cancelForPaymentFailure(orderId, note);

    // Best-effort audit of the actor (the reused path writes system-authored
    // history rows with changedById=null, so the admin identity is captured
    // here). record() never throws (P3-05).
    await this.audit?.record({
      action: 'order.admin_cancel',
      entityType: 'Order',
      entityId: orderId,
      actorUserId,
      before: { status: order.status, paymentStatus: order.paymentStatus },
      after: { status: OrderStatus.CANCELLED, reason: note },
    });

    return result;
  }
}
