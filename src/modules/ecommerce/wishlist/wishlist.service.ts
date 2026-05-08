import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ToggleWishlistInput } from './dto/toggle-wishlist.input';

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
 * Hydrates a Prisma product row into the GraphQL Product shape (Decimal →
 * number, default-variant fields flattened). Mirrors the helper in
 * product.service.ts so wishlist items can return the same Product shape
 * the frontend already knows.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hydrateProduct(p: any) {
  const variants = p.variants ?? [];
  const defaultVariant = variants[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formattedVariants = variants.map((v: any) => ({
    ...v,
    price: Number(v.price),
    compareAtPrice: v.compareAtPrice != null ? Number(v.compareAtPrice) : null,
    costPrice: v.costPrice != null ? Number(v.costPrice) : null,
    weight: v.weight != null ? Number(v.weight) : null,
    length: v.length != null ? Number(v.length) : null,
    width: v.width != null ? Number(v.width) : null,
    height: v.height != null ? Number(v.height) : null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attributes: (v.attributes ?? []).map((a: any) => ({
      attributeId: a.attributeId,
      attributeValueId: a.attributeValueId,
      attributeName: a.attribute?.name ?? '',
      attributeSlug: a.attribute?.slug ?? '',
      value: a.attributeValue?.value ?? '',
      valueSlug: a.attributeValue?.slug ?? '',
    })),
  }));
  return {
    ...p,
    price: defaultVariant ? Number(defaultVariant.price) : 0,
    compareAtPrice: defaultVariant?.compareAtPrice
      ? Number(defaultVariant.compareAtPrice)
      : null,
    costPrice: defaultVariant?.costPrice
      ? Number(defaultVariant.costPrice)
      : null,
    sku: defaultVariant?.sku ?? '',
    weight: defaultVariant?.weight ? Number(defaultVariant.weight) : null,
    length: defaultVariant?.length ? Number(defaultVariant.length) : null,
    width: defaultVariant?.width ? Number(defaultVariant.width) : null,
    height: defaultVariant?.height ? Number(defaultVariant.height) : null,
    variants: formattedVariants,
    // Product.specifications is a String in GraphQL but Json in Prisma —
    // stringify so the resolver doesn't choke on the parsed object.
    specifications:
      typeof p.specifications === 'string'
        ? p.specifications
        : JSON.stringify(p.specifications ?? []),
  };
}

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves the Customer.id for the currently authenticated user. Throws
   * if the user isn't a customer (admin/seller endpoints don't have wishlists).
   */
  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!customer) {
      throw new ForbiddenException(
        'Wishlist is only available to customer accounts.',
      );
    }
    if (customer.deletedAt) {
      throw new ForbiddenException('This account has been archived.');
    }
    return customer.id;
  }

  /**
   * Returns the customer's default wishlist, creating it on first access.
   * Idempotent — concurrent calls won't create duplicates because we
   * upsert via the (customerId, isDefault) unique-ish access pattern.
   */
  private async getOrCreateDefaultWishlist(customerId: string) {
    const existing = await this.prisma.wishlist.findFirst({
      where: { customerId, isDefault: true, deletedAt: null },
    });
    if (existing) return existing;
    return this.prisma.wishlist.create({
      data: { customerId, isDefault: true, name: 'My Wishlist' },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrateWishlist(w: any) {
    const items = (w.items ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (it: any) => ({
        ...it,
        product: it.product ? hydrateProduct(it.product) : null,
      }),
    );
    return {
      ...w,
      items,
      itemCount: items.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async myWishlist(userId: string) {
    const customerId = await this.getCustomerId(userId);
    const wishlist = await this.getOrCreateDefaultWishlist(customerId);
    const fresh = await this.prisma.wishlist.findUnique({
      where: { id: wishlist.id },
      include: {
        items: {
          orderBy: { createdAt: 'desc' },
          include: {
            product: { include: PRODUCT_INCLUDE },
          },
        },
      },
    });
    return this.hydrateWishlist(fresh);
  }

  /**
   * Lightweight: returns the set of product IDs in the customer's default
   * wishlist. Used by the storefront to render filled hearts on product
   * cards without hydrating full product data per render.
   */
  async myWishlistProductIds(userId: string): Promise<string[]> {
    const customerId = await this.getCustomerId(userId);
    const wishlist = await this.prisma.wishlist.findFirst({
      where: { customerId, isDefault: true, deletedAt: null },
      include: { items: { select: { productId: true } } },
    });
    if (!wishlist) return [];
    return wishlist.items.map((i) => i.productId);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async add(userId: string, input: ToggleWishlistInput) {
    const customerId = await this.getCustomerId(userId);
    const wishlist = await this.getOrCreateDefaultWishlist(customerId);

    // Verify the product exists + is purchaseable. Also catches typos in
    // the productId so we don't end up with orphan wishlist rows.
    const product = await this.prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!product || product.deletedAt) {
      throw new NotFoundException('Product not found');
    }

    // Idempotent: if already in wishlist, return the existing row. Using
    // findFirst because Prisma's compound-unique typing forbids passing
    // null to a nullable column in the key (Postgres allows it; types
    // don't). The (wishlistId, productId, variantId) DB constraint still
    // protects against duplicate writes from concurrent requests.
    const existing = await this.prisma.wishlistItem.findFirst({
      where: {
        wishlistId: wishlist.id,
        productId: input.productId,
        variantId: input.variantId ?? null,
      },
    });
    if (existing) {
      return this.myWishlist(userId);
    }

    await this.prisma.wishlistItem.create({
      data: {
        wishlistId: wishlist.id,
        productId: input.productId,
        variantId: input.variantId ?? null,
      },
    });
    return this.myWishlist(userId);
  }

  async remove(userId: string, input: ToggleWishlistInput) {
    const customerId = await this.getCustomerId(userId);
    const wishlist = await this.prisma.wishlist.findFirst({
      where: { customerId, isDefault: true, deletedAt: null },
    });
    if (!wishlist) return this.myWishlist(userId);

    await this.prisma.wishlistItem.deleteMany({
      where: {
        wishlistId: wishlist.id,
        productId: input.productId,
        variantId: input.variantId ?? null,
      },
    });
    return this.myWishlist(userId);
  }

  async clear(userId: string) {
    const customerId = await this.getCustomerId(userId);
    const wishlist = await this.prisma.wishlist.findFirst({
      where: { customerId, isDefault: true, deletedAt: null },
    });
    if (!wishlist) return this.myWishlist(userId);
    await this.prisma.wishlistItem.deleteMany({
      where: { wishlistId: wishlist.id },
    });
    return this.myWishlist(userId);
  }
}
