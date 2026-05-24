import { Injectable } from '@nestjs/common';
import { OrderStatus, ProductStatus, SellerStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

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
}
