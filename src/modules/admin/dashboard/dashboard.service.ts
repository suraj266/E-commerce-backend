import { Injectable } from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ProductStatus,
  RefundStatus,
  SellerStatus,
} from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  AnalyticsBucket,
  AnalyticsRangeInput,
} from './dto/analytics-range.input';
import { AdminAnalytics } from './entities/admin-analytics.entity';

const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

// Every OrderStatus, in pipeline order — used to zero-fill the
// orders-by-status breakdown so the UI always renders a stable set of rows.
const ALL_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

// GraphQL bucket enum → Postgres `date_trunc` unit.
const BUCKET_TO_PG_UNIT: Record<AnalyticsBucket, string> = {
  [AnalyticsBucket.DAY]: 'day',
  [AnalyticsBucket.WEEK]: 'week',
  [AnalyticsBucket.MONTH]: 'month',
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Hard upper bound on the analytics window so a caller can never force an
// unbounded table scan (queries are otherwise gated only by date range).
const MAX_RANGE_MS = 366 * DAY_MS;

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const startOfMonth = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

const startOfNextMonth = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0);

const startOfYear = (d: Date) =>
  new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);

const changePct = (current: number, previous: number): number => {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
};

// Deterministic (UTC) label for a series bucket. Kept off `toLocaleDateString`
// so the server timezone can't shift a `date_trunc`'d UTC bucket into the
// previous day.
const formatBucketLabel = (d: Date, granularity: AnalyticsBucket): string => {
  const month = MONTH_LABELS[d.getUTCMonth()];
  if (granularity === AnalyticsBucket.MONTH) {
    return `${month} ${d.getUTCFullYear()}`;
  }
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${day} ${month}`;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const now = new Date();
    const currStart = startOfMonth(now);
    const currEnd = startOfNextMonth(now);
    const prevStart = startOfMonth(
      new Date(now.getFullYear(), now.getMonth() - 1, 1),
    );
    const prevEnd = currStart;
    const yearStart = startOfYear(now);

    const [
      revenueCurr,
      revenuePrev,
      ordersCurr,
      ordersPrev,
      productsCurr,
      productsPrev,
      usersCurr,
      usersPrev,
      monthlyOrders,
      totalUsersAll,
      distinctBuyers,
      revenueAllAgg,
      activeSellers,
      pendingReturns,
      recentOrders,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: {
          status: { in: REVENUE_STATUSES },
          placedAt: { gte: currStart, lt: currEnd },
          deletedAt: null,
        },
      }),
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        where: {
          status: { in: REVENUE_STATUSES },
          placedAt: { gte: prevStart, lt: prevEnd },
          deletedAt: null,
        },
      }),
      this.prisma.order.count({
        where: {
          status: { not: OrderStatus.CANCELLED },
          placedAt: { gte: currStart, lt: currEnd },
          deletedAt: null,
        },
      }),
      this.prisma.order.count({
        where: {
          status: { not: OrderStatus.CANCELLED },
          placedAt: { gte: prevStart, lt: prevEnd },
          deletedAt: null,
        },
      }),
      this.prisma.product.count({
        where: { status: ProductStatus.ACTIVE, deletedAt: null },
      }),
      // Snapshot: products that were ACTIVE and existed as of end of last month.
      // Status history isn't tracked, so this is a best-effort approximation.
      this.prisma.product.count({
        where: {
          status: ProductStatus.ACTIVE,
          createdAt: { lt: prevEnd },
          OR: [{ deletedAt: null }, { deletedAt: { gte: prevEnd } }],
        },
      }),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({
        where: { status: 'active', createdAt: { lt: prevEnd } },
      }),
      this.prisma.order.findMany({
        where: {
          status: { in: REVENUE_STATUSES },
          placedAt: { gte: yearStart },
          deletedAt: null,
        },
        select: { placedAt: true, totalAmount: true },
      }),
      this.prisma.user.count(),
      this.prisma.order.findMany({
        where: { status: { in: REVENUE_STATUSES }, deletedAt: null },
        distinct: ['customerId'],
        select: { customerId: true },
      }),
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        _count: { _all: true },
        where: { status: { in: REVENUE_STATUSES }, deletedAt: null },
      }),
      this.prisma.seller.count({
        where: { overallStatus: SellerStatus.VERIFIED, deletedAt: null },
      }),
      this.prisma.order.count({
        where: { status: OrderStatus.REFUNDED, deletedAt: null },
      }),
      this.prisma.order.findMany({
        take: 5,
        orderBy: { placedAt: 'desc' },
        where: { deletedAt: null },
        include: {
          customer: { include: { user: { select: { name: true } } } },
          items: { orderBy: { createdAt: 'asc' }, select: { name: true } },
        },
      }),
    ]);

    const monthlyBuckets = MONTH_LABELS.map((m) => ({ month: m, value: 0 }));
    for (const o of monthlyOrders) {
      const m = o.placedAt.getMonth();
      monthlyBuckets[m].value += Number(o.totalAmount);
    }

    const revenueCurrNum = Number(revenueCurr._sum.totalAmount ?? 0);
    const revenuePrevNum = Number(revenuePrev._sum.totalAmount ?? 0);
    const revenueAllSum = Number(revenueAllAgg._sum.totalAmount ?? 0);
    const revenueAllCount = revenueAllAgg._count._all ?? 0;
    const avgOrderValue =
      revenueAllCount > 0 ? revenueAllSum / revenueAllCount : 0;
    const conversionRate =
      totalUsersAll > 0 ? (distinctBuyers.length / totalUsersAll) * 100 : 0;

    return {
      totalRevenue: {
        current: revenueCurrNum,
        previous: revenuePrevNum,
        changePct: changePct(revenueCurrNum, revenuePrevNum),
      },
      totalOrders: {
        current: ordersCurr,
        previous: ordersPrev,
        changePct: changePct(ordersCurr, ordersPrev),
      },
      totalProducts: {
        current: productsCurr,
        previous: productsPrev,
        changePct: changePct(productsCurr, productsPrev),
      },
      activeUsers: {
        current: usersCurr,
        previous: usersPrev,
        changePct: changePct(usersCurr, usersPrev),
      },
      monthlyRevenue: monthlyBuckets,
      conversionRate,
      avgOrderValue,
      activeSellers,
      pendingReturns,
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customer?.user?.name ?? 'Unknown',
        productSummary:
          (o.items[0]?.name ?? 'No items') +
          (o.items.length > 1 ? ` + ${o.items.length - 1} more` : ''),
        totalAmount: Number(o.totalAmount),
        status: o.status,
        placedAt: o.placedAt,
      })),
    };
  }

  /**
   * Platform-wide, date-range scoped analytics for /admin/dashboard.
   *
   * READ-ONLY: pure aggregation over live rows — never mutates money state.
   *
   * Returns:
   *   - revenue: gross GMV, PROCESSED refunds, and net (gross − refunds)
   *   - newSignups: new users + sellers created in range
   *   - gmvSeries: time-bucketed GMV (day/week/month via `date_trunc`)
   *   - ordersByStatus: order counts by status (zero-filled)
   *   - topProducts / topSellers: bounded leaderboards
   *
   * Bounded by construction: the window defaults to the last 30 days, is capped
   * at ~366 days, and the leaderboards take at most 20 rows.
   */
  async getAnalytics(input?: AnalyticsRangeInput): Promise<AdminAnalytics> {
    const now = new Date();
    const to = input?.to ?? now;
    let from = input?.from ?? new Date(to.getTime() - 30 * DAY_MS);
    // Guard an inverted range, then clamp an over-wide span.
    if (from.getTime() >= to.getTime()) {
      from = new Date(to.getTime() - 30 * DAY_MS);
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      from = new Date(to.getTime() - MAX_RANGE_MS);
    }

    const granularity = input?.granularity ?? AnalyticsBucket.DAY;
    const pgUnit = BUCKET_TO_PG_UNIT[granularity];
    const topLimit = Math.min(20, Math.max(1, input?.topLimit ?? 5));

    const revenueOrderWhere: Prisma.OrderWhereInput = {
      deletedAt: null,
      status: { in: REVENUE_STATUSES },
      placedAt: { gte: from, lt: to },
    };

    const [
      grossAgg,
      refundAgg,
      seriesRows,
      statusGroups,
      newUsers,
      newSellers,
      topProductGroups,
      topSellerGroups,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        _sum: { totalAmount: true },
        _count: { _all: true },
        where: revenueOrderWhere,
      }),
      this.prisma.refund.aggregate({
        _sum: { amount: true },
        where: {
          status: RefundStatus.PROCESSED,
          createdAt: { gte: from, lt: to },
        },
      }),
      // Time-bucketed GMV series. `pgUnit` is a fixed whitelist value (never
      // user text); the status list + range bind as parameters.
      this.prisma.$queryRaw<
        Array<{ bucket: Date; gmv: number; orders: number }>
      >(Prisma.sql`
        SELECT date_trunc(${pgUnit}, "placedAt") AS bucket,
               COALESCE(SUM("totalAmount"), 0)::float8 AS gmv,
               COUNT(*)::int AS orders
        FROM "Order"
        WHERE "deletedAt" IS NULL
          AND "status"::text IN (${Prisma.join(REVENUE_STATUSES)})
          AND "placedAt" >= ${from}
          AND "placedAt" < ${to}
        GROUP BY 1
        ORDER BY 1 ASC
      `),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { deletedAt: null, placedAt: { gte: from, lt: to } },
        _count: { _all: true },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: from, lt: to } },
      }),
      this.prisma.seller.count({
        where: { deletedAt: null, createdAt: { gte: from, lt: to } },
      }),
      this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: {
          order: {
            deletedAt: null,
            status: { in: REVENUE_STATUSES },
            placedAt: { gte: from, lt: to },
          },
        },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: topLimit,
      }),
      this.prisma.sellerOrder.groupBy({
        by: ['sellerId'],
        where: {
          deletedAt: null,
          status: { in: REVENUE_STATUSES },
          createdAt: { gte: from, lt: to },
        },
        _sum: { subtotal: true, payoutAmount: true },
        _count: { _all: true },
        orderBy: { _sum: { subtotal: 'desc' } },
        take: topLimit,
      }),
    ]);

    // Resolve current display names for the leaderboards (falls back to a
    // placeholder if a product/seller was hard-deleted after the sale).
    const productIds = topProductGroups.map((g) => g.productId);
    const sellerIds = topSellerGroups.map((g) => g.sellerId);
    const [products, sellers] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      sellerIds.length
        ? this.prisma.seller.findMany({
            where: { id: { in: sellerIds } },
            select: { id: true, displayName: true },
          })
        : Promise.resolve([] as { id: string; displayName: string }[]),
    ]);
    const productNameById = new Map(
      products.map((p): [string, string] => [p.id, p.name]),
    );
    const sellerNameById = new Map(
      sellers.map((s): [string, string] => [s.id, s.displayName]),
    );

    const gross = Number(grossAgg._sum.totalAmount ?? 0);
    const refunds = Number(refundAgg._sum.amount ?? 0);
    const orderCount = grossAgg._count._all ?? 0;

    const statusCountById = new Map(
      statusGroups.map((g): [OrderStatus, number] => [g.status, g._count._all]),
    );
    const ordersByStatus = ALL_ORDER_STATUSES.map((status) => ({
      status,
      count: statusCountById.get(status) ?? 0,
    }));

    const gmvSeries = seriesRows.map((r) => {
      const bucketDate = r.bucket instanceof Date ? r.bucket : new Date(r.bucket);
      return {
        bucket: bucketDate.toISOString(),
        label: formatBucketLabel(bucketDate, granularity),
        gmv: Number(r.gmv),
        orderCount: Number(r.orders),
      };
    });

    const topProducts = topProductGroups.map((g) => ({
      productId: g.productId,
      name: productNameById.get(g.productId) ?? 'Unknown product',
      unitsSold: g._sum.quantity ?? 0,
      grossRevenue: Number(g._sum.totalPrice ?? 0),
    }));

    const topSellers = topSellerGroups.map((g) => ({
      sellerId: g.sellerId,
      sellerName: sellerNameById.get(g.sellerId) ?? 'Unknown seller',
      orderCount: g._count._all ?? 0,
      gmv: Number(g._sum.subtotal ?? 0),
      netPayable: Number(g._sum.payoutAmount ?? 0),
    }));

    return {
      range: { from, to, granularity },
      revenue: {
        gross,
        refunds,
        net: gross - refunds,
        orderCount,
        avgOrderValue: orderCount > 0 ? gross / orderCount : 0,
      },
      newSignups: { users: newUsers, sellers: newSellers },
      gmvSeries,
      ordersByStatus,
      topProducts,
      topSellers,
    };
  }
}
