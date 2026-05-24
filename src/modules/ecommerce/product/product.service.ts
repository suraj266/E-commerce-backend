import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus, ProductType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateProductInput } from './dto/create-product.input';
import { UpdateProductInput } from './dto/update-product.input';
import { SetProductStatusInput } from './dto/set-product-status.input';
import { AdminCreateProductInput } from './dto/admin-create-product.input';
import { AdminUpdateProductInput } from './dto/admin-update-product.input';
import { AddProductImageInput } from './dto/add-product-image.input';
import { UpdateProductImageInput } from './dto/update-product-image.input';
import { ReorderProductImagesInput } from './dto/reorder-product-images.input';
import { ProductSortOrder } from './dto/product-sort.enum';
import { SetVariantAxesInput } from './dto/set-variant-axes.input';
import { GenerateVariantMatrixInput } from './dto/generate-variant-matrix.input';
import { CreateVariantInput } from './dto/create-variant.input';
import { UpdateVariantInput } from './dto/update-variant.input';
import { BulkUpdateVariantsInput } from './dto/bulk-update-variants.input';
import { VariantStatus } from '@prisma/client';
import { InventoryService } from '@/modules/ecommerce/inventory/inventory.service';

const PRODUCT_INCLUDE = {
  images: { orderBy: { displayOrder: 'asc' as const } },
  brand: true,
  category: true,
  tax: true,
  tags: true,
  variants: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
    include: {
      attributes: {
        include: { attribute: true, attributeValue: true },
      },
    },
  },
} as const;

/**
 * Hydrate Prisma → GraphQL shape. Pricing fields (price/compareAtPrice/sku)
 * read from the default variant (Path A). Specifications JSON is stringified
 * for transport because we don't have a JSON GraphQL scalar registered.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrate(p: any) {
  const variants = p.variants ?? [];
  const defaultVariant = variants[0];

  // Format each variant the same way the variant resolver does — converts
  // Decimal → number, formats the attribute junction, etc.
  const taxRate = p.tax?.rate != null ? Number(p.tax.rate) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formattedVariants = variants.map((v: any) => {
    const vPrice = Number(v.price);
    return {
      ...v,
      price: vPrice,
      priceWithTax:
        taxRate != null ? Math.round((vPrice + vPrice * taxRate / 100) * 100) / 100 : null,
      compareAtPrice: v.compareAtPrice != null ? Number(v.compareAtPrice) : null,
      costPrice: v.costPrice != null ? Number(v.costPrice) : null,
      weight: v.weight != null ? Number(v.weight) : null,
      length: v.length != null ? Number(v.length) : null,
      width: v.width != null ? Number(v.width) : null,
      height: v.height != null ? Number(v.height) : null,
      attributes: (v.attributes ?? []).map(
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
    };
  });

  // For VARIABLE products, top-level price = min(variant prices) so storefront
  // listings can show "Starting from ₹X". SIMPLE products just expose the one.
  let price: number | null = null;
  let compareAtPrice: number | null = null;
  let costPrice: number | null = null;
  let sku: string | null = null;
  if (p.productType === 'VARIABLE' && formattedVariants.length > 0) {
    const sortedByPrice = [...formattedVariants].sort(
      (a, b) => a.price - b.price,
    );
    price = sortedByPrice[0].price;
    compareAtPrice = sortedByPrice[0].compareAtPrice ?? null;
  } else if (defaultVariant) {
    price = Number(defaultVariant.price);
    compareAtPrice =
      defaultVariant.compareAtPrice != null
        ? Number(defaultVariant.compareAtPrice)
        : null;
    costPrice =
      defaultVariant.costPrice != null
        ? Number(defaultVariant.costPrice)
        : null;
    sku = defaultVariant.sku ?? null;
  }

  const priceWithTax =
    price != null && taxRate != null
      ? Math.round((price + price * taxRate / 100) * 100) / 100
      : null;

  return {
    ...p,
    price,
    priceWithTax,
    compareAtPrice,
    costPrice,
    sku,
    weight: p.weight != null ? Number(p.weight) : null,
    length: p.length != null ? Number(p.length) : null,
    width: p.width != null ? Number(p.width) : null,
    height: p.height != null ? Number(p.height) : null,
    specifications:
      typeof p.specifications === 'string'
        ? p.specifications
        : JSON.stringify(p.specifications ?? []),
    variants: formattedVariants,
  };
}

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryService: InventoryService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private generateSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  private async ensureUniqueSlug(rawSlug: string, excludeId?: string) {
    const existing = await this.prisma.product.findUnique({
      where: { slug: rawSlug },
    });
    if (!existing) return rawSlug;
    if (excludeId && existing.id === excludeId) return rawSlug;
    return `${rawSlug}-${Date.now()}`;
  }

  private async ensureUniqueSku(rawSku: string, excludeVariantId?: string) {
    const existing = await this.prisma.productVariant.findUnique({
      where: { sku: rawSku },
    });
    if (!existing) return rawSku;
    if (excludeVariantId && existing.id === excludeVariantId) return rawSku;
    return `${rawSku}-${Date.now()}`;
  }

  /**
   * Verifies the user owns the store + store is ACTIVE. Reused from Store
   * ownership pattern.
   */
  private async assertStoreOwnership(userId: string, storeId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller || seller.deletedAt) {
      throw new ForbiddenException(
        'Complete seller onboarding before listing products.',
      );
    }
    if (seller.overallStatus !== 'VERIFIED') {
      throw new ForbiddenException(
        `Sellers must be VERIFIED. Current: ${seller.overallStatus}`,
      );
    }
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.deletedAt) {
      throw new NotFoundException(`Store ${storeId} not found`);
    }
    if (store.sellerId !== seller.id) {
      throw new ForbiddenException('You do not own this store.');
    }
    if (store.status !== 'ACTIVE') {
      throw new ForbiddenException(
        `Store must be ACTIVE to list products. Current: ${store.status}`,
      );
    }
    return { seller, store };
  }

  /** Loads product + asserts caller owns it via store. */
  private async assertProductOwnership(userId: string, productId: string) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller) throw new ForbiddenException('No seller profile.');
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { store: true },
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    if (product.store.sellerId !== seller.id) {
      throw new ForbiddenException('You do not own this product.');
    }
    return product;
  }

  /**
   * Recalculates the lowest variant price and caches it on the Product model
   * for efficient database-level sorting (Phase B optimization).
   */
  private async syncBasePrice(productId: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;

    // Find all active variants
    const variants = await client.productVariant.findMany({
      where: { productId, deletedAt: null },
      select: { price: true },
    });

    if (variants.length === 0) {
      // If no variants, clear basePrice
      await client.product.update({
        where: { id: productId },
        data: { basePrice: null },
      });
      return;
    }

    // lowest price among active variants
    const minPrice = variants.reduce((min, v) => {
      const p = Number(v.price);
      return p < min ? p : min;
    }, Number(variants[0].price));

    await client.product.update({
      where: { id: productId },
      data: { basePrice: minPrice },
    });
  }

  private async validateBrand(brandId?: string | null) {
    if (!brandId) return;
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!brand || brand.deletedAt) {
      throw new BadRequestException(`Brand ${brandId} not found`);
    }
    if (brand.status !== 'ACTIVE') {
      throw new BadRequestException('Selected brand is not active.');
    }
  }

  private async filterValidTagIds(tagIds?: string[] | null) {
    if (!tagIds || tagIds.length === 0) return [];
    const tags = await this.prisma.tag.findMany({
      where: { id: { in: tagIds }, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    return tags.map((t) => t.id);
  }

  // ---------------------------------------------------------------------------
  // Create — atomic Product + default Variant + tag connect
  // ---------------------------------------------------------------------------

  async createMyProduct(userId: string, input: CreateProductInput) {
    const { store } = await this.assertStoreOwnership(userId, input.storeId);
    return this.createProductForStore(store, input);
  }

  /**
   * Owner-agnostic core: writes a Product (+ default variant for SIMPLE) for
   * the given store. Both `createMyProduct` (seller-self, ownership-checked)
   * and `adminCreate` (admin, store-validated) call this.
   *
   * `opts.status` controls initial status — DRAFT for seller-self, admin can
   * pass ACTIVE to publish immediately.
   */
  private async createProductForStore(
    store: { id: string; currencyCode: string },
    input: CreateProductInput,
    opts: { status?: ProductStatus } = {},
  ) {
    await this.validateBrand(input.brandId);
    const validTagIds = await this.filterValidTagIds(input.tagIds);

    const productType = input.productType ?? ProductType.SIMPLE;

    if (productType === ProductType.SIMPLE && (input.price == null || input.price < 0)) {
      throw new BadRequestException('Price is required for SIMPLE products');
    }

    const rawSlug = input.slug || this.generateSlug(input.name);
    const finalSlug = await this.ensureUniqueSlug(rawSlug);

    let specsJson: Prisma.InputJsonValue = [];
    if (input.specifications) {
      try {
        const parsed = JSON.parse(input.specifications);
        if (!Array.isArray(parsed)) {
          throw new BadRequestException('Specifications must be an array');
        }
        specsJson = parsed;
      } catch {
        throw new BadRequestException('Specifications must be valid JSON');
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          storeId: store.id,
          name: input.name,
          slug: finalSlug,
          categoryId: input.categoryId,
          brandId: input.brandId,
          taxId: input.taxId,
          shortDescription: input.shortDescription,
          description: input.description,
          productType,
          status: opts.status ?? ProductStatus.DRAFT,
          isDigital: input.isDigital ?? false,
          weight: input.weight,
          length: input.length,
          width: input.width,
          height: input.height,
          hsnCode: input.hsnCode,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          seoKeywords: input.seoKeywords ?? [],
          specifications: specsJson,
          metadata: { currencyCode: store.currencyCode },
          tags: { connect: validTagIds.map((id) => ({ id })) },
        },
      });

      if (productType === ProductType.SIMPLE) {
        const rawSku =
          input.sku || `${this.generateSlug(input.name)}-${Date.now()}`;
        const finalSku = await this.ensureUniqueSku(rawSku);
        const defaultVariant = await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: finalSku,
            price: input.price!,
            compareAtPrice: input.compareAtPrice,
            costPrice: input.costPrice,
          },
        });
        await this.inventoryService.ensureInventoryRow(
          defaultVariant.id,
          store.id,
          tx,
        );
        await tx.product.update({
          where: { id: product.id },
          data: { basePrice: input.price! },
        });
      }

      return product;
    });

    return this.findOneById(created.id);
  }

  /**
   * Admin: create a product under any store. Skips the seller-ownership
   * check (admin verifies store validity by selecting it from a picker).
   */
  async adminCreate(input: AdminCreateProductInput) {
    const store = await this.prisma.store.findUnique({
      where: { id: input.storeId },
    });
    if (!store || store.deletedAt) {
      throw new NotFoundException(`Store ${input.storeId} not found`);
    }
    if (store.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Store must be ACTIVE. Current: ${store.status}`,
      );
    }
    return this.createProductForStore(store, input, { status: input.status });
  }

  // ---------------------------------------------------------------------------
  // Update — partial; price/sku land on default variant
  // ---------------------------------------------------------------------------

  async updateMyProduct(userId: string, input: UpdateProductInput) {
    const product = await this.assertProductOwnership(userId, input.id);
    return this.updateProductRecord(product, input);
  }

  /**
   * Owner-agnostic core: applies a partial update to a Product (+ default
   * variant for SIMPLE pricing fields). Both `updateMyProduct` (seller-self,
   * ownership-checked) and `adminUpdate` (admin) call this.
   */
  private async updateProductRecord(
    product: { id: string; slug: string },
    input: UpdateProductInput,
  ) {
    if (input.brandId !== undefined) await this.validateBrand(input.brandId);
    const validTagIds =
      input.tagIds !== undefined
        ? await this.filterValidTagIds(input.tagIds)
        : null;

    const slugChange =
      input.slug && input.slug !== product.slug
        ? await this.ensureUniqueSlug(input.slug, product.id)
        : undefined;

    let specsJson: Prisma.InputJsonValue | undefined;
    if (input.specifications !== undefined) {
      try {
        const parsed = JSON.parse(input.specifications);
        if (!Array.isArray(parsed)) {
          throw new BadRequestException('Specifications must be an array');
        }
        specsJson = parsed;
      } catch {
        throw new BadRequestException('Specifications must be valid JSON');
      }
    }

    const productData: Prisma.ProductUpdateInput = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(slugChange ? { slug: slugChange } : {}),
      ...(input.categoryId !== undefined
        ? input.categoryId
          ? { category: { connect: { id: input.categoryId } } }
          : { category: { disconnect: true } }
        : {}),
      ...(input.brandId !== undefined
        ? input.brandId
          ? { brand: { connect: { id: input.brandId } } }
          : { brand: { disconnect: true } }
        : {}),
      ...(input.taxId !== undefined
        ? input.taxId
          ? { tax: { connect: { id: input.taxId } } }
          : { tax: { disconnect: true } }
        : {}),
      ...(input.shortDescription !== undefined
        ? { shortDescription: input.shortDescription }
        : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isDigital !== undefined ? { isDigital: input.isDigital } : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(input.length !== undefined ? { length: input.length } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.hsnCode !== undefined ? { hsnCode: input.hsnCode } : {}),
      ...(input.seoTitle !== undefined ? { seoTitle: input.seoTitle } : {}),
      ...(input.seoDescription !== undefined
        ? { seoDescription: input.seoDescription }
        : {}),
      ...(input.seoKeywords !== undefined ? { seoKeywords: input.seoKeywords } : {}),
      ...(specsJson !== undefined ? { specifications: specsJson } : {}),
      ...(validTagIds !== null
        ? { tags: { set: validTagIds.map((id) => ({ id })) } }
        : {}),
    };

    const variantData: Prisma.ProductVariantUpdateInput = {
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.compareAtPrice !== undefined
        ? { compareAtPrice: input.compareAtPrice }
        : {}),
      ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
    };

    if (input.sku !== undefined && input.sku !== null) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { productId: product.id, deletedAt: null },
      });
      if (variant) {
        variantData.sku = await this.ensureUniqueSku(input.sku, variant.id);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(productData).length > 0) {
        await tx.product.update({ where: { id: product.id }, data: productData });
      }
      if (Object.keys(variantData).length > 0) {
        const variant = await tx.productVariant.findFirst({
          where: { productId: product.id, deletedAt: null },
        });
        if (variant) {
          await tx.productVariant.update({
            where: { id: variant.id },
            data: variantData,
          });
        }
      }
    });

    if (Object.keys(variantData).length > 0) {
      await this.syncBasePrice(product.id);
    }

    return this.findOneById(product.id);
  }

  /**
   * Admin: update any product. Bypasses seller-ownership check.
   * Optionally apply a status change in the same call via `adminSetStatus`.
   */
  async adminUpdate(input: AdminUpdateProductInput) {
    const product = await this.prisma.product.findUnique({
      where: { id: input.id },
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException(`Product ${input.id} not found`);
    }

    const { status, ...rest } = input;
    await this.updateProductRecord(product, rest);

    if (status !== undefined && status !== product.status) {
      return this.adminSetStatus({ id: product.id, status });
    }
    return this.findOneById(product.id);
  }

  // ---------------------------------------------------------------------------
  // Status workflow
  // ---------------------------------------------------------------------------

  async setMyProductStatus(userId: string, input: SetProductStatusInput) {
    const product = await this.assertProductOwnership(userId, input.id);

    if (input.status === ProductStatus.ARCHIVED) {
      throw new ForbiddenException(
        'Only admin can ARCHIVE products. Use INACTIVE to hide.',
      );
    }
    if (product.status === ProductStatus.ARCHIVED) {
      throw new BadRequestException('Archived products cannot be modified.');
    }

    if (input.status === ProductStatus.ACTIVE) {
      const [imageCount, variant] = await Promise.all([
        this.prisma.productImage.count({ where: { productId: product.id } }),
        this.prisma.productVariant.findFirst({
          where: { productId: product.id, deletedAt: null },
        }),
      ]);
      if (imageCount === 0) {
        throw new BadRequestException(
          'Add at least one image before publishing.',
        );
      }
      if (!variant || Number(variant.price) <= 0) {
        throw new BadRequestException(
          'Set a price greater than 0 before publishing.',
        );
      }
    }

    await this.prisma.product.update({
      where: { id: product.id },
      data: { status: input.status },
    });
    return this.findOneById(product.id);
  }

  async adminSetStatus(input: SetProductStatusInput) {
    const product = await this.findOneById(input.id);
    const metadata =
      typeof product.metadata === 'object' && product.metadata !== null
        ? (product.metadata as Record<string, unknown>)
        : {};

    await this.prisma.product.update({
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
    });
    return this.findOneById(input.id);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async findOneById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return hydrate(product);
  }

  async myProducts(userId: string, storeId?: string, status?: ProductStatus) {
    const seller = await this.prisma.seller.findUnique({ where: { userId } });
    if (!seller || seller.deletedAt) return [];

    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        store: { sellerId: seller.id },
        ...(storeId ? { storeId } : {}),
        ...(status ? { status } : {}),
      },
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return products.map(hydrate);
  }

  async myProduct(userId: string, id: string) {
    await this.assertProductOwnership(userId, id);
    return this.findOneById(id);
  }

  async findPublic(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: { ...PRODUCT_INCLUDE, store: true },
    });
    if (
      !product ||
      product.deletedAt ||
      product.status !== ProductStatus.ACTIVE ||
      product.store.status !== 'ACTIVE' ||
      product.store.deletedAt
    ) {
      throw new NotFoundException(`Product "${slug}" not found`);
    }

    // Aggregate inventory per variant so the public PDP can gate "Add to
    // Cart" without an extra round trip. Sum across warehouses for Phase 1
    // multi-warehouse readiness.
    const variantIds = (product.variants ?? []).map((v) => v.id);
    const inventoryRows = variantIds.length
      ? await this.prisma.inventory.findMany({
          where: { variantId: { in: variantIds }, deletedAt: null },
        })
      : [];
    const inventoryByVariant = new Map<
      string,
      { available: number; reorderPoint: number }
    >();
    for (const r of inventoryRows) {
      const prev = inventoryByVariant.get(r.variantId) ?? {
        available: 0,
        reorderPoint: 0,
      };
      inventoryByVariant.set(r.variantId, {
        available: prev.available + r.quantityAvailable,
        // Use the highest reorder point across warehouses — conservative.
        reorderPoint: Math.max(prev.reorderPoint, r.reorderPoint),
      });
    }
    const enrichedProduct = {
      ...product,
      variants: (product.variants ?? []).map((v) => {
        const inv = inventoryByVariant.get(v.id);
        const available = inv?.available ?? 0;
        const reorderPoint = inv?.reorderPoint ?? 0;
        let stockState: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
        if (available <= 0) stockState = 'OUT_OF_STOCK';
        else if (reorderPoint > 0 && available <= reorderPoint)
          stockState = 'LOW_STOCK';
        else stockState = 'IN_STOCK';
        return {
          ...v,
          availableQuantity: available,
          stockState,
        };
      }),
    };
    return hydrate(enrichedProduct);
  }

  /**
   * Public storefront list — only ACTIVE products in ACTIVE non-deleted stores.
   * Filters by store/brand/tag/category slug. Pricing-aware sort goes through
   * the default variant since price lives there (Path A model).
   */
  /**
   * Paginated public catalog. Adds price-range filtering and proper page
   * pagination on top of `findPublicProducts`. Used by /shop and any other
   * customer-facing browse surface that needs to know totals.
   *
   * Price filter applies to the default variant — for SIMPLE products
   * that's the only variant, for VARIABLE products it's the first.
   */
  /**
   * Build the list of category ids that are descendants of (and include)
   * the given root slug. Used by the public catalog so /category/electronics
   * surfaces products from every sub-category beneath it, not only the
   * exact-match root.
   *
   * Single round-trip: pulls all categories once and walks the parent map
   * in memory. Sub-100 categories total in our scale; cheaper than
   * recursive Prisma queries.
   */
  private async buildCategoryDescendantFilter(
    slug: string,
  ): Promise<string[] | null> {
    const root = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true, deletedAt: true, isActive: true },
    });
    if (!root || root.deletedAt || !root.isActive) {
      // Slug doesn't resolve — return an empty list so the product query
      // returns no rows (consistent with old exact-match behavior).
      return [];
    }
    const all = await this.prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    // child-of map
    const byParent = new Map<string, string[]>();
    for (const c of all) {
      const key = c.parentId ?? '__root__';
      const list = byParent.get(key) ?? [];
      list.push(c.id);
      byParent.set(key, list);
    }
    const ids = new Set<string>([root.id]);
    const queue: string[] = [root.id];
    while (queue.length > 0) {
      const next = queue.shift()!;
      for (const child of byParent.get(next) ?? []) {
        if (!ids.has(child)) {
          ids.add(child);
          queue.push(child);
        }
      }
    }
    return [...ids];
  }

  async findPaginatedPublicProducts(filter: {
    storeSlug?: string;
    brandSlug?: string;
    tagSlug?: string;
    categorySlug?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: ProductSortOrder;
    page?: number;
    pageSize?: number;
    /**
     * Free-text search. Case-insensitive substring match across the product's
     * own name + short description AND the joined brand name. v1 uses ILIKE
     * — good enough for typical catalog sizes. v2 should switch to a
     * `tsvector` column with weighted ranking when catalogs grow past ~50k
     * products. See SEARCH.md (TODO).
     */
    search?: string;
  }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(Math.max(filter.pageSize ?? 12, 1), 60);

    const priceBounds: { gte?: number; lte?: number } = {};
    if (filter.minPrice != null) priceBounds.gte = filter.minPrice;
    if (filter.maxPrice != null) priceBounds.lte = filter.maxPrice;
    const hasPriceFilter = Object.keys(priceBounds).length > 0;
    const priceVariantFilter: Prisma.ProductVariantWhereInput = {
      deletedAt: null,
      ...(hasPriceFilter ? { price: priceBounds } : {}),
    };

    // When the customer browses /category/electronics, they expect to see
    // products in EVERY descendant of "electronics" too — not just ones
    // pinned directly to the root. Walk the category tree once to collect
    // all descendant ids, then filter products by `categoryId IN (...)`.
    // (Falls back to exact-slug match if the lookup fails for any reason.)
    const categoryFilter = filter.categorySlug
      ? await this.buildCategoryDescendantFilter(filter.categorySlug)
      : null;

    // Free-text — only kicks in when the query is non-empty after trim.
    // Joined with OR across name / shortDescription / brand name so a search
    // for "samsung" finds both products named "Samsung Galaxy S24" AND
    // products whose brand is "Samsung". Wrapped in an AND with the other
    // filters so the existing facets still narrow the result set.
    const searchTrimmed = (filter.search ?? '').trim();
    const searchFilter: Prisma.ProductWhereInput | null = searchTrimmed
      ? {
          OR: [
            { name: { contains: searchTrimmed, mode: 'insensitive' } },
            {
              shortDescription: {
                contains: searchTrimmed,
                mode: 'insensitive',
              },
            },
            {
              brand: {
                name: { contains: searchTrimmed, mode: 'insensitive' },
              },
            },
          ],
        }
      : null;

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      store: { status: 'ACTIVE', deletedAt: null },
      ...(filter.storeSlug
        ? { store: { slug: filter.storeSlug, status: 'ACTIVE', deletedAt: null } }
        : {}),
      ...(filter.brandSlug ? { brand: { slug: filter.brandSlug } } : {}),
      ...(categoryFilter ? { categoryId: { in: categoryFilter } } : {}),
      ...(filter.tagSlug ? { tags: { some: { slug: filter.tagSlug } } } : {}),
      ...(hasPriceFilter ? { variants: { some: priceVariantFilter } } : {}),
      ...(searchFilter ? { AND: [searchFilter] } : {}),
    };

    // Order determines how we slice.
    let orderBy: Prisma.ProductOrderByWithRelationInput = { createdAt: 'desc' };
    if (filter.sort === ProductSortOrder.PRICE_ASC) {
      orderBy = { basePrice: 'asc' };
    } else if (filter.sort === ProductSortOrder.PRICE_DESC) {
      orderBy = { basePrice: 'desc' };
    }

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items: rows.map(hydrate),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  /**
   * Header search autocomplete. Returns up to `limit` (max 10) lightweight
   * product rows matching the term. Same ILIKE shape as the paginated query
   * but returns only the fields the dropdown actually renders, keeping
   * per-keystroke latency low.
   *
   * Returns BOTH category and product matches so the dropdown can offer
   * a fast jump-to-category alongside individual products. Categories
   * surface first in the response (the frontend renders them as a small
   * section above products).
   */
  async searchSuggestions(args: { q: string; limit?: number }) {
    const term = (args.q ?? '').trim();
    if (term.length < 2) {
      return { categories: [], products: [] };
    }
    const productTake = Math.min(Math.max(args.limit ?? 8, 1), 10);
    const categoryTake = 3; // never more than 3, the dropdown is real-estate-constrained

    // Fire category + product queries in parallel — they're independent.
    const [categoryRows, productRows] = await Promise.all([
      this.prisma.category.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          name: { contains: term, mode: 'insensitive' },
        },
        include: {
          _count: {
            select: {
              products: {
                where: { deletedAt: null, status: ProductStatus.ACTIVE },
              },
            },
          },
        },
        // Categories with more products surface first — feels more useful
        // than alphabetical when the customer is exploring.
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        take: categoryTake,
      }),
      this.prisma.product.findMany({
        where: {
          deletedAt: null,
          status: ProductStatus.ACTIVE,
          store: { status: 'ACTIVE', deletedAt: null },
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { brand: { name: { contains: term, mode: 'insensitive' } } },
          ],
        },
        include: {
          brand: { select: { name: true } },
          images: { orderBy: { displayOrder: 'asc' as const }, take: 1 },
          variants: {
            where: { deletedAt: null },
            orderBy: { price: 'asc' as const },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: productTake,
      }),
    ]);

    return {
      categories: categoryRows.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        productCount: c._count.products,
      })),
      products: productRows.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: p.variants[0] ? Number(p.variants[0].price) : 0,
        imageUrl: p.images[0]?.imageUrl ?? null,
        brandName: p.brand?.name ?? null,
      })),
    };
  }

  async findPublicProducts(filter: {
    storeSlug?: string;
    brandSlug?: string;
    tagSlug?: string;
    categorySlug?: string;
    sort?: ProductSortOrder;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(filter.limit ?? 20, 1), 100);

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: ProductStatus.ACTIVE,
      store: { status: 'ACTIVE', deletedAt: null },
      ...(filter.storeSlug
        ? { store: { slug: filter.storeSlug, status: 'ACTIVE', deletedAt: null } }
        : {}),
      ...(filter.brandSlug ? { brand: { slug: filter.brandSlug } } : {}),
      ...(filter.categorySlug ? { category: { slug: filter.categorySlug } } : {}),
      ...(filter.tagSlug ? { tags: { some: { slug: filter.tagSlug } } } : {}),
    };

    // Sort — for price sorts we order by the first variant's price. Prisma
    // doesn't allow ordering by relation aggregates directly, so we fetch
    // products + sort in-memory for the price cases. Newest is direct.
    if (
      filter.sort === ProductSortOrder.PRICE_ASC ||
      filter.sort === ProductSortOrder.PRICE_DESC
    ) {
      const products = await this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        // No DB-level price sort — collect and sort below
      });
      const hydrated = products.map(hydrate);
      hydrated.sort((a, b) => {
        const pa = a.price ?? 0;
        const pb = b.price ?? 0;
        return filter.sort === ProductSortOrder.PRICE_ASC ? pa - pb : pb - pa;
      });
      return hydrated.slice(0, limit);
    }

    const products = await this.prisma.product.findMany({
      where,
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return products.map(hydrate);
  }

  async adminFindAll(filter: {
    status?: ProductStatus;
    storeId?: string;
    brandId?: string;
    categoryId?: string;
  }) {
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.storeId ? { storeId: filter.storeId } : {}),
        ...(filter.brandId ? { brandId: filter.brandId } : {}),
        ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
      },
      include: PRODUCT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return products.map(hydrate);
  }

  // ---------------------------------------------------------------------------
  // Soft delete
  // ---------------------------------------------------------------------------

  async removeMyProduct(userId: string, id: string) {
    const product = await this.assertProductOwnership(userId, id);
    if (
      product.status !== ProductStatus.DRAFT &&
      product.status !== ProductStatus.ARCHIVED
    ) {
      throw new BadRequestException(
        'Only DRAFT or ARCHIVED products can be deleted. Use INACTIVE to hide.',
      );
    }
    await this.prisma.product.update({
      where: { id: product.id },
      data: { deletedAt: new Date() },
    });
    return this.findOneById(product.id).catch(() => ({ id: product.id }));
  }

  // ---------------------------------------------------------------------------
  // Image management
  // ---------------------------------------------------------------------------

  async addImage(userId: string, input: AddProductImageInput) {
    await this.assertProductOwnership(userId, input.productId);

    return this.prisma.$transaction(async (tx) => {
      const existingCount = await tx.productImage.count({
        where: { productId: input.productId },
      });
      const isPrimary = input.isPrimary || existingCount === 0;
      if (isPrimary) {
        await tx.productImage.updateMany({
          where: { productId: input.productId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const displayOrder = input.displayOrder ?? existingCount;
      return tx.productImage.create({
        data: {
          productId: input.productId,
          imageUrl: input.imageUrl,
          altText: input.altText,
          isPrimary,
          displayOrder,
        },
      });
    });
  }

  async updateImage(userId: string, input: UpdateProductImageInput) {
    const image = await this.prisma.productImage.findUnique({
      where: { id: input.id },
    });
    if (!image) throw new NotFoundException(`Image ${input.id} not found`);
    await this.assertProductOwnership(userId, image.productId);

    return this.prisma.$transaction(async (tx) => {
      if (input.isPrimary === true) {
        await tx.productImage.updateMany({
          where: {
            productId: image.productId,
            isPrimary: true,
            NOT: { id: input.id },
          },
          data: { isPrimary: false },
        });
      }
      return tx.productImage.update({
        where: { id: input.id },
        data: {
          ...(input.altText !== undefined ? { altText: input.altText } : {}),
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
          ...(input.displayOrder !== undefined
            ? { displayOrder: input.displayOrder }
            : {}),
        },
      });
    });
  }

  async removeImage(userId: string, id: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id } });
    if (!image) throw new NotFoundException(`Image ${id} not found`);
    await this.assertProductOwnership(userId, image.productId);
    return this.prisma.productImage.delete({ where: { id } });
  }

  async reorderImages(userId: string, input: ReorderProductImagesInput) {
    await this.assertProductOwnership(userId, input.productId);
    const images = await this.prisma.productImage.findMany({
      where: { productId: input.productId },
      select: { id: true },
    });
    const dbIds = new Set(images.map((i) => i.id));
    for (const id of input.imageIds) {
      if (!dbIds.has(id)) {
        throw new BadRequestException(
          `Image ${id} does not belong to product ${input.productId}`,
        );
      }
    }
    const ops = input.imageIds.map((id, idx) =>
      this.prisma.productImage.update({
        where: { id },
        data: { displayOrder: idx },
      }),
    );
    await this.prisma.$transaction(ops);
    return true;
  }

  // =========================================================================
  // VARIANTS — Phase B
  // =========================================================================

  /**
   * Helper — load a variant + its attribute values (with attribute info)
   * formatted for the GraphQL ProductVariant entity.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatVariant(v: any) {
    return {
      ...v,
      price: Number(v.price),
      compareAtPrice: v.compareAtPrice != null ? Number(v.compareAtPrice) : null,
      costPrice: v.costPrice != null ? Number(v.costPrice) : null,
      weight: v.weight != null ? Number(v.weight) : null,
      length: v.length != null ? Number(v.length) : null,
      width: v.width != null ? Number(v.width) : null,
      height: v.height != null ? Number(v.height) : null,
      attributes: (v.attributes ?? []).map(
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
    };
  }

  /** Returns all variants of a product the seller owns. */
  async myProductVariants(userId: string, productId: string) {
    await this.assertProductOwnership(userId, productId);
    const variants = await this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
      include: {
        attributes: {
          include: { attribute: true, attributeValue: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return variants.map((v) => this.formatVariant(v));
  }

  /**
   * Returns the variant axes a product uses, hydrated with attribute + value
   * details. Reads from product.metadata.variantAxes (array of attribute IDs).
   */
  async myProductVariantAxes(userId: string, productId: string) {
    await this.assertProductOwnership(userId, productId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    const axisIds = this.readVariantAxes(product?.metadata);
    if (axisIds.length === 0) return [];

    const attributes = await this.prisma.productAttribute.findMany({
      where: { id: { in: axisIds }, deletedAt: null },
      include: {
        values: {
          where: { deletedAt: null },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
    // Preserve the original order
    const sorted = axisIds
      .map((id) => attributes.find((a) => a.id === id))
      .filter(Boolean) as typeof attributes;
    return sorted.map((a) => ({
      attributeId: a.id,
      attributeName: a.name,
      attributeSlug: a.slug,
      values: a.values,
    }));
  }

  /**
   * Replace the variant axes for a VARIABLE product. If variants already
   * exist, removing an axis (or changing axes) is destructive and requires
   * the caller to delete those variants first.
   */
  async setVariantAxes(userId: string, input: SetVariantAxesInput) {
    const product = await this.assertProductOwnership(userId, input.productId);
    if (product.productType !== ProductType.VARIABLE) {
      throw new BadRequestException(
        'Only VARIABLE products can have variant axes',
      );
    }

    // Validate every attribute is variant-capable + active
    const attrs = await this.prisma.productAttribute.findMany({
      where: { id: { in: input.attributeIds }, deletedAt: null },
    });
    if (attrs.length !== input.attributeIds.length) {
      throw new BadRequestException(
        'One or more attributes not found or deleted',
      );
    }
    for (const a of attrs) {
      if (!a.isVariantAttribute) {
        throw new BadRequestException(
          `Attribute "${a.name}" is not marked as a variant attribute`,
        );
      }
    }

    // If axes change while variants exist, block — seller must clean up first
    const existingAxes = this.readVariantAxes(product.metadata);
    const sameSet =
      existingAxes.length === input.attributeIds.length &&
      existingAxes.every((id) => input.attributeIds.includes(id));
    if (!sameSet) {
      const variantCount = await this.prisma.productVariant.count({
        where: { productId: product.id, deletedAt: null },
      });
      if (variantCount > 0) {
        throw new BadRequestException(
          'Delete all variants before changing axes',
        );
      }
    }

    const metadata = (product.metadata ?? {}) as Record<string, unknown>;
    await this.prisma.product.update({
      where: { id: product.id },
      data: {
        metadata: { ...metadata, variantAxes: input.attributeIds },
      },
    });

    return this.myProductVariantAxes(userId, product.id);
  }

  private readVariantAxes(metadata: unknown): string[] {
    if (!metadata || typeof metadata !== 'object') return [];
    const axes = (metadata as { variantAxes?: unknown }).variantAxes;
    if (!Array.isArray(axes)) return [];
    return axes.filter((id): id is string => typeof id === 'string');
  }

  /**
   * Cartesian-product matrix generation. Skips combinations that already
   * exist (idempotent — safe to re-run after adding more values).
   */
  async generateVariantMatrix(
    userId: string,
    input: GenerateVariantMatrixInput,
  ) {
    const product = await this.assertProductOwnership(userId, input.productId);
    if (product.productType !== ProductType.VARIABLE) {
      throw new BadRequestException(
        'Matrix generation is only for VARIABLE products',
      );
    }

    const productAxes = this.readVariantAxes(product.metadata);
    if (productAxes.length === 0) {
      throw new BadRequestException('Set variant axes first');
    }
    // Input axes must match product axes exactly
    const inputAxisIds = input.axes.map((a) => a.attributeId);
    const sameSet =
      productAxes.length === inputAxisIds.length &&
      productAxes.every((id) => inputAxisIds.includes(id));
    if (!sameSet) {
      throw new BadRequestException(
        'Axes in the input must match the product’s configured axes',
      );
    }

    // Validate value IDs belong to their attributes
    const allValueIds = input.axes.flatMap((a) => a.valueIds);
    const allValues = await this.prisma.productAttributeValue.findMany({
      where: { id: { in: allValueIds }, deletedAt: null },
      include: { attribute: true },
    });
    const valueMap = new Map(allValues.map((v) => [v.id, v]));
    for (const axis of input.axes) {
      for (const vid of axis.valueIds) {
        const v = valueMap.get(vid);
        if (!v) {
          throw new BadRequestException(`Attribute value ${vid} not found`);
        }
        if (v.attributeId !== axis.attributeId) {
          throw new BadRequestException(
            `Value ${v.value} doesn’t belong to its axis`,
          );
        }
      }
    }

    // Cartesian product, ordered by product axes (for stable SKU)
    const orderedAxes = productAxes
      .map((aid) => input.axes.find((a) => a.attributeId === aid)!)
      .filter(Boolean);
    const cartesian = (
      arrays: { attributeId: string; valueIds: string[] }[],
    ): string[][] => {
      if (arrays.length === 0) return [[]];
      const [first, ...rest] = arrays;
      const tail = cartesian(rest);
      return first.valueIds.flatMap((v) => tail.map((t) => [v, ...t]));
    };
    const combos = cartesian(orderedAxes);
    const explosionLimit = 100;
    if (combos.length > explosionLimit) {
      throw new BadRequestException(
        `Matrix would create ${combos.length} variants — limit is ${explosionLimit}`,
      );
    }

    // Existing variants: skip combos that already exist
    const existingVariants = await this.prisma.productVariant.findMany({
      where: { productId: product.id, deletedAt: null },
      include: { attributes: true },
    });
    const existingComboKeys = new Set(
      existingVariants.map((v) =>
        v.attributes
          .map((a) => a.attributeValueId)
          .sort()
          .join('|'),
      ),
    );

    const productSlug = product.slug;
    const created: { id: string }[] = [];

    for (const combo of combos) {
      const key = [...combo].sort().join('|');
      if (existingComboKeys.has(key)) continue;

      const valueSlugs = combo
        .map((vid) => valueMap.get(vid)!.slug)
        .filter(Boolean);
      const rawSku = `${productSlug}-${valueSlugs.join('-')}`;
      const finalSku = await this.ensureUniqueSku(rawSku);

      const variant = await this.prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: finalSku,
          price: input.basePrice,
          compareAtPrice: input.baseCompareAtPrice,
          costPrice: input.baseCostPrice,
          attributes: {
            create: combo.map((vid) => ({
              attributeId: valueMap.get(vid)!.attributeId,
              attributeValueId: vid,
            })),
          },
        },
      });
      await this.inventoryService.ensureInventoryRow(
        variant.id,
        product.storeId,
      );
      created.push({ id: variant.id });
    }

    await this.syncBasePrice(product.id);

    return this.myProductVariants(userId, product.id);
  }

  async addMyVariant(userId: string, input: CreateVariantInput) {
    const product = await this.assertProductOwnership(userId, input.productId);
    if (product.productType !== ProductType.VARIABLE) {
      throw new BadRequestException(
        'Cannot add variants to a SIMPLE product',
      );
    }
    const productAxes = this.readVariantAxes(product.metadata);
    if (productAxes.length === 0) {
      throw new BadRequestException('Set variant axes first');
    }

    // The supplied attribute values must cover all axes (one value per axis)
    const values = await this.prisma.productAttributeValue.findMany({
      where: { id: { in: input.attributeValueIds }, deletedAt: null },
    });
    const axisIdsCovered = new Set(values.map((v) => v.attributeId));
    if (axisIdsCovered.size !== productAxes.length) {
      throw new BadRequestException(
        'Supply exactly one value per axis (no duplicates, no missing)',
      );
    }
    for (const aid of productAxes) {
      if (!axisIdsCovered.has(aid)) {
        throw new BadRequestException(
          `Missing value for one of the variant axes`,
        );
      }
    }

    // Block duplicate combo
    const existing = await this.prisma.productVariant.findMany({
      where: { productId: product.id, deletedAt: null },
      include: { attributes: true },
    });
    const newKey = [...input.attributeValueIds].sort().join('|');
    for (const v of existing) {
      const k = v.attributes
        .map((a) => a.attributeValueId)
        .sort()
        .join('|');
      if (k === newKey) {
        throw new BadRequestException('A variant with this combination already exists');
      }
    }

    // SKU
    const orderedSlugs = productAxes
      .map((aid) => values.find((v) => v.attributeId === aid)?.slug)
      .filter((s): s is string => Boolean(s));
    const rawSku = input.sku || `${product.slug}-${orderedSlugs.join('-')}`;
    const finalSku = await this.ensureUniqueSku(rawSku);

    const variant = await this.prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: finalSku,
        price: input.price,
        compareAtPrice: input.compareAtPrice,
        costPrice: input.costPrice,
        imageUrl: input.imageUrl,
        attributes: {
          create: input.attributeValueIds.map((vid) => ({
            attributeId: values.find((v) => v.id === vid)!.attributeId,
            attributeValueId: vid,
          })),
        },
      },
      include: {
        attributes: { include: { attribute: true, attributeValue: true } },
      },
    });
    await this.inventoryService.ensureInventoryRow(
      variant.id,
      product.storeId,
    );
    await this.syncBasePrice(product.id);
    return this.formatVariant(variant);
  }

  async updateMyVariant(userId: string, input: UpdateVariantInput) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: input.id },
      include: { product: true },
    });
    if (!variant || variant.deletedAt) {
      throw new NotFoundException(`Variant ${input.id} not found`);
    }
    await this.assertProductOwnership(userId, variant.productId);

    const data: Prisma.ProductVariantUpdateInput = {
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.compareAtPrice !== undefined
        ? { compareAtPrice: input.compareAtPrice }
        : {}),
      ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };
    if (input.sku && input.sku !== variant.sku) {
      data.sku = await this.ensureUniqueSku(input.sku, variant.id);
    }

    const updated = await this.prisma.productVariant.update({
      where: { id: variant.id },
      data,
      include: {
        attributes: { include: { attribute: true, attributeValue: true } },
      },
    });
    await this.syncBasePrice(variant.productId);
    return this.formatVariant(updated);
  }

  async removeMyVariant(userId: string, id: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id },
    });
    if (!variant || variant.deletedAt) {
      throw new NotFoundException(`Variant ${id} not found`);
    }
    await this.assertProductOwnership(userId, variant.productId);

    // Delete attribute junction rows + soft-delete the variant. We return
    // the full variant for client-cache consistency (so Apollo can patch).
    const [, updated] = await this.prisma.$transaction([
      this.prisma.productVariantAttribute.deleteMany({
        where: { variantId: id },
      }),
      this.prisma.productVariant.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: {
          attributes: { include: { attribute: true, attributeValue: true } },
        },
      }),
    ]);
    await this.syncBasePrice(variant.productId);
    return this.formatVariant(updated);
  }

  async bulkUpdateMyVariants(
    userId: string,
    input: BulkUpdateVariantsInput,
  ) {
    await this.assertProductOwnership(userId, input.productId);

    if (
      input.price === undefined &&
      input.compareAtPrice === undefined &&
      input.status === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one of price / compareAtPrice / status',
      );
    }

    // Determine which variants get updated
    const where: Prisma.ProductVariantWhereInput = {
      productId: input.productId,
      deletedAt: null,
    };
    if (input.filterValueIds && input.filterValueIds.length > 0) {
      where.attributes = {
        some: { attributeValueId: { in: input.filterValueIds } },
      };
    }

    const data: Prisma.ProductVariantUpdateManyMutationInput = {};
    if (input.price !== undefined) data.price = input.price;
    if (input.compareAtPrice !== undefined) {
      data.compareAtPrice = input.compareAtPrice;
    }
    if (input.status !== undefined) data.status = input.status;

    const result = await this.prisma.productVariant.updateMany({ where, data });
    if (input.price !== undefined) {
      await this.syncBasePrice(input.productId);
    }
    return result.count;
  }
}
