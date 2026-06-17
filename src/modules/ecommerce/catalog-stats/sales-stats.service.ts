/**
 * SalesStatsService — keeps Product sales-velocity stats fresh.
 *
 * Recomputes `unitsSold7d`, `unitsSold30d`, `lastSoldAt` from OrderItem
 * aggregation, and reconciles the denormalized `onSale` flag from variant
 * prices. These power the data-driven "Bestseller" / "Trending" / "Sale"
 * auto-labels and smart-collection rules.
 *
 * Runs daily (cron) + once on boot + on-demand (admin trigger / verify).
 */

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

const DAY_MS = 86_400_000;

/** SellerOrder statuses that count a line item as "sold". */
const SOLD_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

@Injectable()
export class SalesStatsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SalesStatsService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Populate stats shortly after boot so a fresh deploy has data. */
  onApplicationBootstrap(): void {
    // Fire-and-forget; never block startup.
    void this.recomputeAll().catch((err) =>
      this.logger.warn(`Initial sales-stats run failed: ${(err as Error).message}`),
    );
  }

  /** Nightly refresh. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledRecompute(): Promise<void> {
    await this.recomputeAll();
  }

  /**
   * Recompute sales velocity (7d/30d) + lastSoldAt + onSale for every
   * non-deleted product. Idempotent; safe to call repeatedly. Guards against
   * overlapping runs.
   */
  async recomputeAll(now: Date = new Date()): Promise<{ products: number }> {
    if (this.running) {
      this.logger.debug('Sales-stats recompute already in progress; skipping.');
      return { products: 0 };
    }
    this.running = true;
    try {
      const since7 = new Date(now.getTime() - 7 * DAY_MS);
      const since30 = new Date(now.getTime() - 30 * DAY_MS);

      const soldWhere: Prisma.OrderItemWhereInput = {
        sellerOrder: { is: { status: { in: SOLD_STATUSES } } },
      };

      const [sum7, sum30, lastSold] = await Promise.all([
        this.prisma.orderItem.groupBy({
          by: ['productId'],
          _sum: { quantity: true },
          where: { ...soldWhere, createdAt: { gte: since7 } },
        }),
        this.prisma.orderItem.groupBy({
          by: ['productId'],
          _sum: { quantity: true },
          where: { ...soldWhere, createdAt: { gte: since30 } },
        }),
        this.prisma.orderItem.groupBy({
          by: ['productId'],
          _max: { createdAt: true },
          where: soldWhere,
        }),
      ]);

      const map7 = new Map(sum7.map((r) => [r.productId, r._sum.quantity ?? 0]));
      const map30 = new Map(sum30.map((r) => [r.productId, r._sum.quantity ?? 0]));
      const mapLast = new Map(
        lastSold.map((r) => [r.productId, r._max.createdAt ?? null]),
      );

      // Reset everyone, then apply the products that actually have sales.
      await this.prisma.product.updateMany({
        data: { unitsSold7d: 0, unitsSold30d: 0 },
      });
      const productIds = new Set<string>([
        ...map7.keys(),
        ...map30.keys(),
        ...mapLast.keys(),
      ]);
      for (const id of productIds) {
        await this.prisma.product.update({
          where: { id },
          data: {
            unitsSold7d: map7.get(id) ?? 0,
            unitsSold30d: map30.get(id) ?? 0,
            lastSoldAt: mapLast.get(id) ?? undefined,
          },
        });
      }

      const onSaleCount = await this.reconcileOnSale();

      this.logger.log(
        `Sales-stats recomputed: ${productIds.size} products with sales, onSale set on ${onSaleCount}.`,
      );
      return { products: productIds.size };
    } finally {
      this.running = false;
    }
  }

  /**
   * Recompute the denormalized `onSale` flag for every product from its active
   * variants (onSale = any variant with compareAtPrice > price). Primary
   * maintenance happens in ProductService on save; this is a self-healing
   * reconcile (e.g. for directly-seeded products).
   */
  async reconcileOnSale(): Promise<number> {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        onSale: true,
        variants: {
          where: { deletedAt: null },
          select: { price: true, compareAtPrice: true },
        },
      },
    });

    let changed = 0;
    for (const p of products) {
      const onSale = p.variants.some(
        (v) =>
          v.compareAtPrice != null &&
          Number(v.compareAtPrice) > Number(v.price),
      );
      if (onSale !== p.onSale) {
        await this.prisma.product.update({
          where: { id: p.id },
          data: { onSale },
        });
        changed++;
      }
    }
    return changed;
  }
}
