/**
 * BackInStockService — wishlist "it's back in stock!" alerts (Phase 4).
 *
 * READ-ONLY over inventory + wishlist (never edits inventory.service). It infers
 * the 0→in-stock transition purely from current state + its own dedupe/re-arm
 * ledger (BackInStockAlert), so it needs no inventory event feed:
 *
 *   runSweep() (cron, every 30 min):
 *     1. loads live wishlist items + their current availability (bulk, 3 reads);
 *     2. RE-ARMS items now OUT of stock that still carry a ledger row (delete it);
 *     3. for items now IN stock with NO ledger row, INSERTs the row + enqueues a
 *        durable `notification.back_in_stock` outbox event — ATOMICALLY, and only
 *        when the insert actually wrote (createMany count > 0), so an overlapping
 *        sweep never double-alerts. A fresh ledger row's `id` seeds the outbox +
 *        bell dedupe keys, so a genuine LATER restock (row was deleted on re-arm)
 *        legitimately re-alerts.
 *
 *   sendBackInStockAlert() (outbox EMAILS handler):
 *     re-reads live state, writes the in-app bell (which auto-fans SMS/push via
 *     NotificationService.create) + sends the email. Idempotent + best-effort;
 *     re-checks stock and no-ops if it sold out again before the handler ran.
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { OutboxService } from '@/modules/outbox/outbox.service';
import { OUTBOX_QUEUE } from '@/modules/outbox/outbox.constants';
import { config } from '@/common/config/config';
import { NotificationService } from './notification.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { PrivacyService } from '@/modules/compliance/privacy/privacy.service';
import {
  NOTIFICATION_OUTBOX_EVENT,
  NOTIFICATION_TYPE,
} from './notification.constants';

/** Safety valve so a pathological wishlist volume can't OOM one sweep. */
const SWEEP_MAX_ITEMS = 50000;

/** Outbox payload for a single back-in-stock alert. */
interface BackInStockPayload {
  alertId: string;
  wishlistItemId: string;
  variantId: string | null;
  productId: string;
  customerId: string;
  userId: string;
}

/** A live wishlist item projected to what the sweep needs. */
interface SweepItem {
  id: string;
  productId: string;
  variantId: string | null;
  customerId: string;
  userId: string | null;
}

@Injectable()
export class BackInStockService {
  private readonly logger = new Logger(BackInStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    // Same module (NotificationService) + imported EmailModule (EmailService);
    // optional trailing so unit tests can construct with just prisma + outbox.
    private readonly notifications?: NotificationService,
    private readonly email?: EmailService,
    // Marketing-consent gate for the (marketing-class) back-in-stock EMAIL —
    // same authoritative canMarket() the SMS channel uses. Optional-trailing;
    // the app injects it (NotificationModule imports PrivacyModule). Review #6.
    private readonly privacy?: PrivacyService,
  ) {}

  // ---------------------------------------------------------------------------
  // Sweep (cron)
  // ---------------------------------------------------------------------------

  /**
   * One back-in-stock sweep. Returns how many alerts were enqueued and how many
   * ledger rows were re-armed. Safe to run repeatedly (idempotent).
   */
  async runSweep(): Promise<{ alerted: number; rearmed: number }> {
    const rawItems = await this.prisma.wishlistItem.findMany({
      where: { wishlist: { deletedAt: null } },
      select: {
        id: true,
        productId: true,
        variantId: true,
        wishlist: {
          select: { customerId: true, customer: { select: { userId: true } } },
        },
      },
      take: SWEEP_MAX_ITEMS,
    });
    if (rawItems.length === SWEEP_MAX_ITEMS) {
      this.logger.warn(
        `Back-in-stock sweep hit the ${SWEEP_MAX_ITEMS}-item cap; some wishlist items were not evaluated this run.`,
      );
    }
    if (rawItems.length === 0) return { alerted: 0, rearmed: 0 };

    const items: SweepItem[] = rawItems.map((i) => ({
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      customerId: i.wishlist.customerId,
      userId: i.wishlist.customer?.userId ?? null,
    }));

    const { availByVariant, activeVariantIds, variantsByProduct } =
      await this.resolveAvailability(items);

    // Per-item in-stock decision + the variant that triggered it.
    const inStockVariant = (it: SweepItem): string | null => {
      if (it.variantId) {
        if (!activeVariantIds.has(it.variantId)) return null;
        return (availByVariant.get(it.variantId) ?? 0) > 0 ? it.variantId : null;
      }
      const vs = variantsByProduct.get(it.productId) ?? [];
      const hit = vs.find((v) => (availByVariant.get(v) ?? 0) > 0);
      return hit ?? null;
    };

    // Existing ledger rows for these items (the "already alerted / armed" set).
    const existing = await this.prisma.backInStockAlert.findMany({
      where: { wishlistItemId: { in: items.map((i) => i.id) } },
      select: { wishlistItemId: true },
    });
    const alerted = new Set(existing.map((e) => e.wishlistItemId));

    const toRearm: string[] = [];
    const toAlert: Array<{ item: SweepItem; variantId: string }> = [];
    for (const it of items) {
      const trigger = inStockVariant(it);
      const hasRow = alerted.has(it.id);
      if (!trigger && hasRow) {
        toRearm.push(it.id); // out of stock again ⇒ re-arm
      } else if (trigger && !hasRow && it.userId) {
        toAlert.push({ item: it, variantId: trigger });
      }
    }

    let rearmed = 0;
    if (toRearm.length > 0) {
      const res = await this.prisma.backInStockAlert.deleteMany({
        where: { wishlistItemId: { in: toRearm } },
      });
      rearmed = res.count;
    }

    let alertedCount = 0;
    for (const { item, variantId } of toAlert) {
      if (await this.enqueueAlert(item, variantId)) alertedCount++;
    }

    return { alerted: alertedCount, rearmed };
  }

  /**
   * Bulk-resolve availability for a batch of wishlist items:
   *   - `activeVariantIds`: directly-wishlisted variants that are ACTIVE + on an
   *     ACTIVE product (others can never count as "in stock").
   *   - `variantsByProduct`: ACTIVE variants of whole-product wishlist items.
   *   - `availByVariant`: Σ quantityAvailable per variant across warehouses.
   */
  private async resolveAvailability(items: SweepItem[]): Promise<{
    availByVariant: Map<string, number>;
    activeVariantIds: Set<string>;
    variantsByProduct: Map<string, string[]>;
  }> {
    const directVariantIds = uniq(
      items.filter((i) => i.variantId).map((i) => i.variantId as string),
    );
    const wholeProductIds = uniq(
      items.filter((i) => !i.variantId).map((i) => i.productId),
    );

    // Directly-wishlisted variants that are purchasable (active variant + product).
    const activeVariantIds = new Set<string>();
    if (directVariantIds.length > 0) {
      const rows = await this.prisma.productVariant.findMany({
        where: {
          id: { in: directVariantIds },
          status: 'ACTIVE',
          deletedAt: null,
          product: { status: 'ACTIVE', deletedAt: null },
        },
        select: { id: true },
      });
      rows.forEach((r) => activeVariantIds.add(r.id));
    }

    // Active variants of whole-product wishlist items.
    const variantsByProduct = new Map<string, string[]>();
    if (wholeProductIds.length > 0) {
      const rows = await this.prisma.productVariant.findMany({
        where: {
          productId: { in: wholeProductIds },
          status: 'ACTIVE',
          deletedAt: null,
          product: { status: 'ACTIVE', deletedAt: null },
        },
        select: { id: true, productId: true },
      });
      for (const r of rows) {
        const list = variantsByProduct.get(r.productId) ?? [];
        list.push(r.id);
        variantsByProduct.set(r.productId, list);
      }
    }

    // Availability per relevant variant, summed across warehouses.
    const allVariantIds = uniq([
      ...activeVariantIds,
      ...[...variantsByProduct.values()].flat(),
    ]);
    const availByVariant = new Map<string, number>();
    if (allVariantIds.length > 0) {
      const grouped = await this.prisma.inventory.groupBy({
        by: ['variantId'],
        where: { variantId: { in: allVariantIds }, deletedAt: null },
        _sum: { quantityAvailable: true },
      });
      for (const g of grouped) {
        availByVariant.set(g.variantId, g._sum.quantityAvailable ?? 0);
      }
    }

    return { availByVariant, activeVariantIds, variantsByProduct };
  }

  /**
   * Write the dedupe ledger row + enqueue the durable alert, atomically. Returns
   * true when THIS call wrote the row (and thus enqueued); false if another
   * sweep already alerted this item (createMany skipDuplicates → count 0).
   */
  private async enqueueAlert(
    item: SweepItem,
    variantId: string,
  ): Promise<boolean> {
    const alertId = randomUUID();
    const payload: BackInStockPayload = {
      alertId,
      wishlistItemId: item.id,
      variantId: item.variantId, // null for whole-product wishlist items
      productId: item.productId,
      customerId: item.customerId,
      userId: item.userId as string,
    };

    return this.prisma.$transaction(async (tx) => {
      const res = await tx.backInStockAlert.createMany({
        data: [
          {
            id: alertId,
            wishlistItemId: item.id,
            variantId, // the concrete in-stock variant that triggered it
            productId: item.productId,
            customerId: item.customerId,
            userId: item.userId as string,
          },
        ],
        skipDuplicates: true,
      });
      if (res.count === 0) return false; // another sweep won the race

      await this.outbox.enqueue(tx, {
        type: NOTIFICATION_OUTBOX_EVENT.BACK_IN_STOCK,
        queue: OUTBOX_QUEUE.EMAILS,
        payload: payload as unknown as Prisma.InputJsonValue,
        dedupeKey: `bis:${alertId}`,
      });
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Outbox handler (EMAILS queue) — invoked by EmailsProcessor.
  // ---------------------------------------------------------------------------

  /**
   * Deliver one back-in-stock alert: in-app bell (auto-fans SMS/push) + email.
   * Re-reads live state (canonical outbox); no-ops if the item was removed, the
   * product went inactive, or it sold out again before this ran. Throws only on
   * a genuine email send failure so the outbox retries.
   */
  async sendBackInStockAlert(payload: BackInStockPayload): Promise<void> {
    const item = await this.prisma.wishlistItem.findUnique({
      where: { id: payload.wishlistItemId },
      select: { id: true },
    });
    if (!item) return; // removed from wishlist ⇒ nothing to alert

    const product = await this.prisma.product.findUnique({
      where: { id: payload.productId },
      select: { id: true, name: true, slug: true, status: true, deletedAt: true },
    });
    if (!product || product.deletedAt || product.status !== 'ACTIVE') return;

    // Soft re-check: if it sold out again before the handler ran, skip — the
    // next sweep re-arms + re-alerts on the following restock.
    if (!(await this.stillInStock(payload))) return;

    const link = `/products/${product.slug}`;
    const title = 'Back in stock';
    const body = `${product.name} is back in stock.`;

    // In-app bell first (idempotent on the per-alert dedupeKey). This ALSO fans
    // the alert to SMS/push via NotificationService.create's channel fan-out.
    await this.notifications?.create({
      userId: payload.userId,
      type: NOTIFICATION_TYPE.BACK_IN_STOCK,
      title,
      body,
      data: {
        productId: product.id,
        variantId: payload.variantId,
        slug: product.slug,
        link,
      },
      dedupeKey: `notif:back_in_stock:${payload.alertId}`,
    });

    // Email (best-effort). Skips cleanly when SMTP/template is unconfigured.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.userId },
      select: { email: true, name: true },
    });
    if (!user?.email || !this.email) return;

    // back_in_stock is marketing-class — gate the EMAIL on the SAME authoritative
    // consent as the SMS channel (review #6), so a customer who withdrew
    // marketing consent isn't emailed. Fail-closed if the gate isn't wired.
    const canMarket = this.privacy
      ? await this.privacy.canMarket(payload.userId)
      : false;
    if (!canMarket) return;

    const result = await this.email.send('back_in_stock', user.email, {
      customerName: user.name ?? 'there',
      productName: product.name,
      productLink: `${config.FRONTEND_URL ?? ''}${link}`,
    });
    if (!result.sent && !result.skipped) {
      throw new Error(`back_in_stock email failed: ${result.message}`);
    }
  }

  /** Current availability check for one alert payload (variant or whole-product). */
  private async stillInStock(payload: BackInStockPayload): Promise<boolean> {
    if (payload.variantId) {
      return (await this.sumAvailable([payload.variantId])) > 0;
    }
    const variants = await this.prisma.productVariant.findMany({
      where: {
        productId: payload.productId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (variants.length === 0) return false;
    return (await this.sumAvailable(variants.map((v) => v.id))) > 0;
  }

  private async sumAvailable(variantIds: string[]): Promise<number> {
    if (variantIds.length === 0) return 0;
    const agg = await this.prisma.inventory.aggregate({
      where: { variantId: { in: variantIds }, deletedAt: null },
      _sum: { quantityAvailable: true },
    });
    return agg._sum.quantityAvailable ?? 0;
  }
}

/** De-dup a string array preserving nothing but uniqueness. */
function uniq(values: string[]): string[] {
  return [...new Set(values)];
}
