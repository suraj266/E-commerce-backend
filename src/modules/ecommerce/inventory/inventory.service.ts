import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { StockState } from './entities/inventory.entity';
import { InventoryMovementType } from './entities/inventory-movement.entity';
import { AdjustInventoryInput } from './dto/adjust-inventory.input';
import { SetReorderPointInput } from './dto/set-reorder-point.input';

/**
 * InventoryService
 *
 * Sprint 2.6 M1 — read APIs + manual adjustments + reorder-point config.
 * Reservation hooks (reserve / release / commit) are stubbed for Sprint 2.8
 * when orders land — see end of file.
 *
 * Concurrency: every quantity-mutating method runs in a Prisma transaction
 * and re-reads the row inside the transaction so two concurrent adjusts
 * can't double-write. Available stock is forbidden from going below zero.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private deriveStockState(
    available: number,
    reorderPoint: number,
  ): StockState {
    if (available <= 0) return StockState.OUT_OF_STOCK;
    if (reorderPoint > 0 && available <= reorderPoint) {
      return StockState.LOW_STOCK;
    }
    return StockState.IN_STOCK;
  }

  /** Hydrate a Prisma inventory row into the GraphQL Inventory entity shape. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrate(row: any) {
    const stockState = this.deriveStockState(
      row.quantityAvailable,
      row.reorderPoint,
    );

    // Surface the variant's parent product as a top-level `product` field
    // so dashboard listings don't have to traverse `variant.product`.
    const product = row.variant?.product ?? null;

    // The GraphQL ProductVariantAttribute type expects flat fields
    // (attributeName, attributeSlug, value, valueSlug). Prisma returns the
    // nested `attribute` and `attributeValue` relations — flatten here so
    // serialization doesn't blow up on non-nullable fields.
    const variant = row.variant
      ? {
          ...row.variant,
          attributes: (row.variant.attributes ?? []).map(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (a: any) => ({
              attributeId: a.attributeId,
              attributeValueId: a.attributeValueId,
              attributeName: a.attribute?.name ?? '',
              attributeSlug: a.attribute?.slug ?? '',
              value: a.attributeValue?.value ?? '',
              valueSlug: a.attributeValue?.slug ?? '',
            }),
          ),
        }
      : null;

    return { ...row, variant, stockState, product };
  }

  /**
   * Loads the seller's record and asserts they own the store that the given
   * variant belongs to. Returns the variant + its product for downstream use.
   */
  private async assertVariantOwnership(userId: string, variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        product: { include: { store: { include: { seller: true } } } },
      },
    });
    if (!variant || variant.deletedAt) {
      throw new NotFoundException(`Variant ${variantId} not found`);
    }
    const seller = variant.product.store.seller;
    if (!seller || seller.userId !== userId) {
      throw new ForbiddenException('You do not own this variant.');
    }
    return variant;
  }

  /** Resolves the warehouse to write into. If caller didn't pass one, picks
   * the variant's store's default warehouse. */
  private async resolveWarehouseId(
    variantStoreId: string,
    explicitWarehouseId: string | undefined,
  ): Promise<string> {
    if (explicitWarehouseId) {
      const wh = await this.prisma.warehouse.findUnique({
        where: { id: explicitWarehouseId },
      });
      if (!wh || wh.deletedAt || wh.storeId !== variantStoreId) {
        throw new BadRequestException(
          `Warehouse ${explicitWarehouseId} does not belong to this variant's store.`,
        );
      }
      return wh.id;
    }
    const def = await this.prisma.warehouse.findFirst({
      where: { storeId: variantStoreId, isDefault: true, deletedAt: null },
    });
    if (!def) {
      throw new BadRequestException(
        'Store has no default warehouse — add one in /seller/warehouses.',
      );
    }
    return def.id;
  }

  // ---------------------------------------------------------------------------
  // Inventory row lifecycle (called by ProductService when variants are created)
  // ---------------------------------------------------------------------------

  /**
   * Idempotently ensure an Inventory row exists for (variant, warehouse).
   * Defaults to the variant's store's default warehouse when warehouse is
   * omitted. Called from ProductService after creating a variant.
   *
   * Accepts an optional Prisma transaction client so it can ride along with
   * the variant creation transaction — callers should pass `tx` when they
   * already have one open.
   */
  async ensureInventoryRow(
    variantId: string,
    storeId: string,
    tx?: Prisma.TransactionClient,
    warehouseId?: string,
  ) {
    const client = tx ?? this.prisma;

    let whId = warehouseId;
    if (!whId) {
      const def = await client.warehouse.findFirst({
        where: { storeId, isDefault: true, deletedAt: null },
      });
      if (!def) {
        // Caller is in the middle of variant creation but the store has no
        // default warehouse. We don't want to hard-fail variant creation —
        // log and skip; seller can adjust inventory later once they add
        // a warehouse. Backfill migration covers existing stores.
        return null;
      }
      whId = def.id;
    }

    const existing = await client.inventory.findUnique({
      where: { variantId_warehouseId: { variantId, warehouseId: whId } },
    });
    if (existing && !existing.deletedAt) return existing;

    return client.inventory.create({
      data: {
        variantId,
        warehouseId: whId,
        quantityAvailable: 0,
        quantityReserved: 0,
        quantityOnHand: 0,
        reorderPoint: 0,
        reorderQuantity: 0,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Self (seller-managed) — read APIs
  // ---------------------------------------------------------------------------

  /**
   * List inventory for the seller's stores, with optional filters.
   * Includes variant + product + warehouse so the UI can render row context
   * without N+1 queries.
   */
  async myInventory(
    userId: string,
    filters: {
      storeId?: string;
      warehouseId?: string;
      productId?: string;
      lowStockOnly?: boolean;
      search?: string;
    } = {},
  ) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller || seller.deletedAt) {
      throw new ForbiddenException('Seller profile required.');
    }

    const warehouseFilter: Prisma.WarehouseWhereInput = {
      deletedAt: null,
      store: { sellerId: seller.id, deletedAt: null },
    };
    if (filters.storeId) warehouseFilter.storeId = filters.storeId;

    const variantFilter: Prisma.ProductVariantWhereInput = {
      deletedAt: null,
      product: { deletedAt: null },
    };
    if (filters.productId) variantFilter.productId = filters.productId;
    if (filters.search) {
      const s = filters.search;
      variantFilter.OR = [
        { sku: { contains: s, mode: 'insensitive' } },
        { product: { name: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const where: Prisma.InventoryWhereInput = {
      deletedAt: null,
      variant: variantFilter,
      warehouse: warehouseFilter,
    };
    if (filters.warehouseId) {
      where.warehouseId = filters.warehouseId;
    }

    const rows = await this.prisma.inventory.findMany({
      where,
      include: {
        variant: {
          include: {
            product: { include: { brand: true, category: true } },
            attributes: {
              include: {
                attribute: true,
                attributeValue: true,
              },
            },
          },
        },
        warehouse: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const hydrated = rows.map((r) => this.hydrate(r));

    if (filters.lowStockOnly) {
      return hydrated.filter(
        (r) => r.stockState !== StockState.IN_STOCK,
      );
    }
    return hydrated;
  }

  /** Single inventory row by (variant, warehouse). */
  async myInventoryByVariant(
    userId: string,
    variantId: string,
    warehouseId?: string,
  ) {
    const variant = await this.assertVariantOwnership(userId, variantId);
    const whId = await this.resolveWarehouseId(
      variant.product.storeId,
      warehouseId,
    );
    const row = await this.prisma.inventory.findUnique({
      where: { variantId_warehouseId: { variantId, warehouseId: whId } },
      include: {
        variant: { include: { product: true } },
        warehouse: true,
      },
    });
    if (!row || row.deletedAt) {
      // Auto-create on first read so older variants from before the backfill
      // never 404 — the row is always derivable.
      const created = await this.ensureInventoryRow(
        variantId,
        variant.product.storeId,
        undefined,
        whId,
      );
      if (!created) {
        throw new NotFoundException(
          'Inventory row not found and could not be auto-created.',
        );
      }
      const refetched = await this.prisma.inventory.findUnique({
        where: { id: created.id },
        include: {
          variant: { include: { product: true } },
          warehouse: true,
        },
      });
      return refetched ? this.hydrate(refetched) : null;
    }
    return this.hydrate(row);
  }

  // ---------------------------------------------------------------------------
  // Admin — cross-store reads (gated by inventory:read permission)
  // ---------------------------------------------------------------------------

  /**
   * Inventory rows for a product across all of its variants and warehouses,
   * regardless of which seller owns the store. Used by the admin product
   * detail Sheet for stock visibility.
   */
  async adminInventoryByProduct(productId: string) {
    const rows = await this.prisma.inventory.findMany({
      where: {
        deletedAt: null,
        variant: { productId, deletedAt: null },
      },
      include: {
        variant: {
          include: {
            product: true,
            attributes: {
              include: { attribute: true, attributeValue: true },
            },
          },
        },
        warehouse: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map((r) => this.hydrate(r));
  }

  /** Audit trail — paginated. */
  async myInventoryMovements(
    userId: string,
    filters: { variantId?: string; warehouseId?: string; limit?: number },
  ) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller || seller.deletedAt) {
      throw new ForbiddenException('Seller profile required.');
    }

    const limit = Math.min(filters.limit ?? 50, 200);

    const where: Prisma.InventoryMovementWhereInput = {
      warehouse: {
        store: { sellerId: seller.id, deletedAt: null },
        deletedAt: null,
      },
    };
    if (filters.variantId) where.variantId = filters.variantId;
    if (filters.warehouseId) where.warehouseId = filters.warehouseId;

    return this.prisma.inventoryMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  // ---------------------------------------------------------------------------
  // Self — mutations
  // ---------------------------------------------------------------------------

  /**
   * Adjust inventory for a variant. Atomic: re-reads the row inside the
   * transaction, computes new totals, persists, and writes the matching
   * InventoryMovement audit row in the same commit.
   *
   * Negative `quantityAvailable` is forbidden — adjustments that would drive
   * available below zero throw BadRequestException so sellers can't oversell
   * by accident.
   */
  async adjustInventory(userId: string, input: AdjustInventoryInput) {
    if (input.delta == null && input.newQuantityOnHand == null) {
      throw new BadRequestException(
        'Provide either `delta` (relative) or `newQuantityOnHand` (absolute).',
      );
    }
    if (input.delta != null && input.newQuantityOnHand != null) {
      throw new BadRequestException(
        '`delta` and `newQuantityOnHand` are mutually exclusive.',
      );
    }

    const variant = await this.assertVariantOwnership(userId, input.variantId);
    const whId = await this.resolveWarehouseId(
      variant.product.storeId,
      input.warehouseId,
    );

    return this.prisma.$transaction(async (tx) => {
      // Ensure row exists (idempotent, in same transaction).
      let row = await tx.inventory.findUnique({
        where: {
          variantId_warehouseId: { variantId: input.variantId, warehouseId: whId },
        },
      });
      if (!row) {
        row = await tx.inventory.create({
          data: {
            variantId: input.variantId,
            warehouseId: whId,
            quantityAvailable: 0,
            quantityReserved: 0,
            quantityOnHand: 0,
            reorderPoint: 0,
            reorderQuantity: 0,
          },
        });
      }
      if (row.deletedAt) {
        throw new ConflictException('Inventory row is archived.');
      }

      const onHandBefore = row.quantityOnHand;
      const delta =
        input.delta != null
          ? input.delta
          : (input.newQuantityOnHand as number) - onHandBefore;

      const newOnHand = onHandBefore + delta;
      const newAvailable = newOnHand - row.quantityReserved;

      if (newAvailable < 0) {
        throw new BadRequestException(
          `Adjustment would drive available stock to ${newAvailable}. Refused.`,
        );
      }
      if (newOnHand < 0) {
        throw new BadRequestException(
          `Adjustment would drive on-hand stock to ${newOnHand}. Refused.`,
        );
      }

      // Recount-style adjustments stamp lastCountedAt.
      const lastCountedAt =
        input.movementType === InventoryMovementType.ADJUSTMENT &&
        input.newQuantityOnHand != null
          ? new Date()
          : row.lastCountedAt;

      const updated = await tx.inventory.update({
        where: { id: row.id },
        data: {
          quantityOnHand: newOnHand,
          quantityAvailable: newAvailable,
          lastCountedAt,
        },
      });

      await tx.inventoryMovement.create({
        data: {
          inventoryId: row.id,
          variantId: input.variantId,
          warehouseId: whId,
          movementType: input.movementType,
          quantityChange: delta,
          quantityBefore: onHandBefore,
          quantityAfter: newOnHand,
          notes: input.notes,
          createdById: userId,
        },
      });

      const fresh = await tx.inventory.findUnique({
        where: { id: updated.id },
        include: {
          variant: { include: { product: true } },
          warehouse: true,
        },
      });
      return this.hydrate(fresh!);
    });
  }

  /** Update reorder threshold (low-stock alert trigger). */
  async setReorderPoint(userId: string, input: SetReorderPointInput) {
    const variant = await this.assertVariantOwnership(userId, input.variantId);
    const whId = await this.resolveWarehouseId(
      variant.product.storeId,
      input.warehouseId,
    );

    // Ensure row exists first.
    await this.ensureInventoryRow(
      input.variantId,
      variant.product.storeId,
      undefined,
      whId,
    );

    const updated = await this.prisma.inventory.update({
      where: {
        variantId_warehouseId: { variantId: input.variantId, warehouseId: whId },
      },
      data: {
        reorderPoint: input.reorderPoint,
        reorderQuantity: input.reorderQuantity ?? undefined,
      },
      include: {
        variant: { include: { product: true } },
        warehouse: true,
      },
    });
    return this.hydrate(updated);
  }

  // ---------------------------------------------------------------------------
  // Reservation / commit / release lifecycle
  //
  // These three operations are performed INLINE by the order pipeline rather
  // than going through this service, because each one needs to participate
  // in the same Prisma transaction as the order/sellerOrder writes. Pointers:
  //
  //   - Reserve  → order-placement.service.ts (placeOrder transaction)
  //                decrement quantityAvailable, increment quantityReserved
  //
  //   - Commit   → seller-order.service.ts (updateStatus → SHIPPED branch)
  //                decrement quantityOnHand, decrement quantityReserved
  //
  //   - Release  → order.service.ts cancelMyOrder + seller-order.service.ts
  //                updateStatus → CANCELLED branch
  //                increment quantityAvailable, decrement quantityReserved
  //
  // If a future refactor wants to centralise these, the right move is to
  // expose helpers that accept a `tx` parameter so the caller still owns the
  // transaction boundary. Don't reintroduce stand-alone reserve()/commit()
  // methods that open their own transactions — that's how you double-debit
  // inventory under contention.
  // ---------------------------------------------------------------------------
}
