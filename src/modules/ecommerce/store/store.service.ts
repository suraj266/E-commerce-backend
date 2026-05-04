import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StoreStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateStoreInput } from './dto/create-store.input';
import { UpdateStoreInput } from './dto/update-store.input';
import { SetStoreStatusInput } from './dto/set-store-status.input';
import { CreateWarehouseInput } from './dto/create-warehouse.input';
import { UpdateWarehouseInput } from './dto/update-warehouse.input';

@Injectable()
export class StoreService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private generateSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  /**
   * Resolves the Seller record for the currently authenticated user. Throws
   * if the user has no seller profile or hasn't been verified yet — only
   * verified sellers may create or manage stores.
   */
  private async assertVerifiedSeller(userId: string) {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
    });
    if (!seller || seller.deletedAt) {
      throw new ForbiddenException(
        'You must complete seller onboarding before managing stores.',
      );
    }
    if (seller.overallStatus !== 'VERIFIED') {
      throw new ForbiddenException(
        `Sellers must be VERIFIED to create or modify stores. Current status: ${seller.overallStatus}`,
      );
    }
    return seller;
  }

  /** Loads a store and asserts the current user owns it (via seller record). */
  private async assertOwnership(userId: string, storeId: string) {
    const seller = await this.assertVerifiedSeller(userId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store || store.deletedAt) {
      throw new NotFoundException(`Store ${storeId} not found`);
    }
    if (store.sellerId !== seller.id) {
      throw new ForbiddenException('You do not own this store.');
    }
    return store;
  }

  // ---------------------------------------------------------------------------
  // Self (seller-managed) — store core
  // ---------------------------------------------------------------------------

  async createMyStore(userId: string, input: CreateStoreInput) {
    const seller = await this.assertVerifiedSeller(userId);

    const rawSlug = input.slug || this.generateSlug(input.name);
    const existing = await this.prisma.store.findUnique({
      where: { slug: rawSlug },
    });
    const finalSlug = existing ? `${rawSlug}-${Date.now()}` : rawSlug;

    // Atomic: store + default warehouse so every store can immediately hold
    // inventory. Address is a placeholder the seller edits before fulfilling
    // any orders — see /seller/warehouses.
    return this.prisma.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          sellerId: seller.id,
          name: input.name,
          slug: finalSlug,
          description: input.description,
          logoUrl: input.logoUrl,
          bannerUrl: input.bannerUrl,
          currencyCode: input.currencyCode ?? 'INR',
          timezone: input.timezone ?? 'Asia/Kolkata',
          locale: input.locale ?? 'en-IN',
          supportEmail: input.supportEmail,
          supportPhone: input.supportPhone,
          isFeatured: false, // admin only
        },
      });

      await tx.warehouse.create({
        data: {
          storeId: store.id,
          name: 'Main warehouse',
          code: 'MAIN',
          addressLine1: 'TBD — please update before fulfilling orders',
          city: 'TBD',
          state: 'TBD',
          postalCode: '000000',
          countryCode: 'IN',
          isDefault: true,
          isActive: true,
        },
      });

      return tx.store.findUniqueOrThrow({
        where: { id: store.id },
        include: { warehouses: { where: { deletedAt: null } } },
      });
    });
  }

  /**
   * Returns the default warehouse for a store, or throws if none exists.
   * Used by inventory module to know where to place auto-created stock rows
   * when sellers add new variants. Every store should have a default
   * warehouse created during `createMyStore`; older stores get one via the
   * inventory backfill migration.
   */
  async getDefaultWarehouseForStore(storeId: string) {
    const wh = await this.prisma.warehouse.findFirst({
      where: { storeId, isDefault: true, deletedAt: null },
    });
    if (!wh) {
      throw new BadRequestException(
        `Store ${storeId} has no default warehouse. Add one in /seller/warehouses.`,
      );
    }
    return wh;
  }

  async updateMyStore(userId: string, input: UpdateStoreInput) {
    const store = await this.assertOwnership(userId, input.id);

    const { id: _id, slug, currencyCode, ...rest } = input;
    const data: Prisma.StoreUpdateInput = { ...rest };

    // Slug uniqueness — only when seller explicitly changes it
    if (slug && slug !== store.slug) {
      const conflict = await this.prisma.store.findUnique({ where: { slug } });
      if (conflict && conflict.id !== store.id) {
        throw new ConflictException(`Slug "${slug}" already taken`);
      }
      data.slug = slug;
    }

    // Currency immutable once products exist
    if (currencyCode && currencyCode !== store.currencyCode) {
      const productCount = await this.prisma.product.count({
        where: { storeId: store.id },
      });
      if (productCount > 0) {
        throw new BadRequestException(
          'Cannot change currency after products have been added to the store.',
        );
      }
      data.currencyCode = currencyCode;
    }

    return this.prisma.store.update({
      where: { id: store.id },
      data,
      include: { warehouses: { where: { deletedAt: null } } },
    });
  }

  async submitMyStoreForReview(userId: string, storeId: string) {
    const store = await this.assertOwnership(userId, storeId);
    if (store.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only DRAFT stores can be submitted. Current: ${store.status}`,
      );
    }
    const warehouseCount = await this.prisma.warehouse.count({
      where: { storeId: store.id, deletedAt: null, isActive: true },
    });
    if (warehouseCount === 0) {
      throw new BadRequestException(
        'Add at least one active warehouse before submitting the store.',
      );
    }
    // For MVP: skip admin review queue, go straight to ACTIVE.
    return this.prisma.store.update({
      where: { id: store.id },
      data: { status: 'ACTIVE' },
      include: { warehouses: { where: { deletedAt: null } } },
    });
  }

  async myStores(userId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller || seller.deletedAt) return [];
    return this.prisma.store.findMany({
      where: { sellerId: seller.id, deletedAt: null },
      include: { warehouses: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async myStore(userId: string, id: string) {
    await this.assertOwnership(userId, id);
    return this.prisma.store.findUnique({
      where: { id },
      include: { warehouses: { where: { deletedAt: null } } },
    });
  }

  async removeMyStore(userId: string, id: string) {
    const store = await this.assertOwnership(userId, id);
    const productCount = await this.prisma.product.count({
      where: { storeId: store.id },
    });
    if (productCount > 0) {
      throw new BadRequestException(
        'Cannot delete a store with products. Archive products first.',
      );
    }
    return this.prisma.store.update({
      where: { id: store.id },
      data: { deletedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async findAll(filterStatus?: StoreStatus) {
    return this.prisma.store.findMany({
      where: {
        deletedAt: null,
        ...(filterStatus ? { status: filterStatus } : {}),
      },
      include: { warehouses: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const store = await this.prisma.store.findUnique({
      where: { id },
      include: { warehouses: { where: { deletedAt: null } } },
    });
    if (!store || store.deletedAt) {
      throw new NotFoundException(`Store ${id} not found`);
    }
    return store;
  }

  async setStatus(input: SetStoreStatusInput) {
    const store = await this.findOne(input.id);
    const metadata =
      typeof store.metadata === 'object' && store.metadata !== null
        ? (store.metadata as Record<string, unknown>)
        : {};

    return this.prisma.store.update({
      where: { id: input.id },
      data: {
        status: input.status,
        metadata: {
          ...metadata,
          lastStatusAction: {
            status: input.status,
            reason: input.reason ?? null,
            at: new Date().toISOString(),
          },
        },
      },
      include: { warehouses: { where: { deletedAt: null } } },
    });
  }

  async adminRemove(id: string) {
    await this.findOne(id);
    return this.prisma.store.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Public — used by /store/[slug] storefront
  // ---------------------------------------------------------------------------

  async findPublic(slug: string) {
    const store = await this.prisma.store.findUnique({
      where: { slug },
    });
    if (!store || store.deletedAt || store.status !== 'ACTIVE') {
      throw new NotFoundException(`Store "${slug}" not found`);
    }
    return store;
  }

  // ---------------------------------------------------------------------------
  // Warehouse — seller-managed, scoped to their stores
  // ---------------------------------------------------------------------------

  async addMyWarehouse(userId: string, input: CreateWarehouseInput) {
    await this.assertOwnership(userId, input.storeId);

    const codeConflict = await this.prisma.warehouse.findFirst({
      where: { storeId: input.storeId, code: input.code, deletedAt: null },
    });
    if (codeConflict) {
      throw new ConflictException(
        `Warehouse code "${input.code}" already exists in this store`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.warehouse.count({
        where: { storeId: input.storeId, deletedAt: null },
      });
      const shouldBeDefault = input.isDefault || existingCount === 0;

      if (shouldBeDefault) {
        await tx.warehouse.updateMany({
          where: { storeId: input.storeId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }

      return tx.warehouse.create({
        data: {
          storeId: input.storeId,
          name: input.name,
          code: input.code,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          countryCode: input.countryCode ?? 'IN',
          phone: input.phone,
          isDefault: shouldBeDefault,
        },
      });
    });
  }

  async updateMyWarehouse(userId: string, input: UpdateWarehouseInput) {
    const { id, ...data } = input;
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse || warehouse.deletedAt) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    await this.assertOwnership(userId, warehouse.storeId);

    return this.prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.warehouse.updateMany({
          where: {
            storeId: warehouse.storeId,
            isDefault: true,
            deletedAt: null,
            NOT: { id },
          },
          data: { isDefault: false },
        });
      }
      return tx.warehouse.update({ where: { id }, data });
    });
  }

  async removeMyWarehouse(userId: string, id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse || warehouse.deletedAt) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    await this.assertOwnership(userId, warehouse.storeId);

    const inventoryCount = await this.prisma.inventory.count({
      where: { warehouseId: id },
    });
    if (inventoryCount > 0) {
      throw new BadRequestException(
        'Cannot delete warehouse with inventory. Move stock first.',
      );
    }

    return this.prisma.warehouse.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async myWarehouses(userId: string, storeId: string) {
    await this.assertOwnership(userId, storeId);
    return this.prisma.warehouse.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }
}
