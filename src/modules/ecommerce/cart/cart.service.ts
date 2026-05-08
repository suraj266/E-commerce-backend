import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AddToCartInput } from './dto/add-to-cart.input';
import { UpdateCartItemQtyInput } from './dto/update-cart-item-qty.input';
import { RemoveCartItemInput } from './dto/remove-cart-item.input';

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

const STOCK = {
  IN_STOCK: 'IN_STOCK',
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
} as const;

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolves the Customer.id for the currently authenticated user. Throws
   * if the user isn't a customer (admin/seller endpoints don't have carts).
   */
  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!customer) {
      throw new ForbiddenException('Cart is only available to customer accounts.');
    }
    if (customer.deletedAt) {
      throw new ForbiddenException('This account has been archived.');
    }
    return customer.id;
  }

  private async getOrCreateCart(customerId: string) {
    const existing = await this.prisma.cart.findUnique({
      where: { customerId },
    });
    if (existing) return existing;
    return this.prisma.cart.create({ data: { customerId } });
  }

  /**
   * Loads the variant + verifies it's purchaseable. Returns the variant
   * with its parent product attached.
   */
  private async loadPurchaseableVariant(variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        product: { select: { id: true, status: true, deletedAt: true } },
      },
    });
    if (!variant || variant.deletedAt) {
      throw new NotFoundException('Variant not found');
    }
    if (
      !variant.product ||
      variant.product.deletedAt ||
      variant.product.status !== 'ACTIVE'
    ) {
      throw new BadRequestException('This product is no longer available.');
    }
    return variant;
  }

  /**
   * Aggregate available stock for a variant across all warehouses. We sum
   * `quantityAvailable` (which is already net of reservations). Returns
   * 0 if no inventory rows exist — treated as out-of-stock.
   */
  private async sumVariantStock(variantId: string): Promise<number> {
    const agg = await this.prisma.inventory.aggregate({
      where: { variantId, deletedAt: null },
      _sum: { quantityAvailable: true },
    });
    return Number(agg._sum.quantityAvailable ?? 0);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrateProduct(p: any) {
    if (!p) return null;
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

  /**
   * Hydrates a cart row + its items into the GraphQL Cart shape. Computes
   * lineTotal, subtotal, priceChanged, stockState, and itemCount.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async hydrateCart(cart: any) {
    // Fetch live stock for every variant in one batched aggregation. We
    // can't directly aggregate per-variant in one query without group-by;
    // doing N small queries here is acceptable since carts rarely exceed
    // ~20 lines.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cart.items ?? []).map(async (it: any) => {
        const available = await this.sumVariantStock(it.variantId);
        const stockState =
          available <= 0
            ? STOCK.OUT_OF_STOCK
            : available <= it.quantity
              ? STOCK.LOW_STOCK
              : STOCK.IN_STOCK;
        const unitPriceSnapshot = Number(it.unitPriceSnapshot);
        const unitPriceCurrent = it.variant
          ? Number(it.variant.price)
          : unitPriceSnapshot;
        const priceChanged = unitPriceCurrent !== unitPriceSnapshot;
        const lineTotal = it.quantity * unitPriceCurrent;
        // Flatten the variant.attributes relation into the GraphQL shape
        // (attributeName/value/etc.). Prisma returns nested `attribute`
        // and `attributeValue` joins; the GraphQL ProductVariantAttribute
        // type is flat and non-nullable.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const flattenedAttrs = (it.variant?.attributes ?? []).map((a: any) => ({
          attributeId: a.attributeId,
          attributeValueId: a.attributeValueId,
          attributeName: a.attribute?.name ?? '',
          attributeSlug: a.attribute?.slug ?? '',
          value: a.attributeValue?.value ?? '',
          valueSlug: a.attributeValue?.slug ?? '',
        }));

        return {
          ...it,
          unitPriceSnapshot,
          unitPriceCurrent,
          priceChanged,
          lineTotal,
          availableQuantity: available,
          stockState,
          variant: it.variant
            ? {
                ...it.variant,
                price: unitPriceCurrent,
                attributes: flattenedAttrs,
              }
            : null,
          product: this.hydrateProduct(it.product),
        };
      }),
    );

    const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
    const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
    const needsReview = items.some(
      (i) => i.priceChanged || i.stockState === STOCK.OUT_OF_STOCK,
    );

    return {
      ...cart,
      items,
      itemCount,
      subtotal,
      needsReview,
    };
  }

  private async loadHydratedCart(customerId: string) {
    const cart = await this.getOrCreateCart(customerId);
    const fresh = await this.prisma.cart.findUnique({
      where: { id: cart.id },
      include: {
        items: {
          orderBy: { createdAt: 'desc' },
          include: {
            product: { include: PRODUCT_INCLUDE },
            // Variant.attributes is non-nullable in GraphQL — must include
            // the relation here AND flatten it in `hydrateCart` below so
            // the resolver doesn't return undefined.
            variant: {
              include: {
                attributes: {
                  include: { attribute: true, attributeValue: true },
                },
              },
            },
          },
        },
      },
    });
    return this.hydrateCart(fresh);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async myCart(userId: string) {
    const customerId = await this.getCustomerId(userId);
    return this.loadHydratedCart(customerId);
  }

  /**
   * Lightweight: returns the total quantity sum across all cart items —
   * used for the header badge so the navbar can avoid fetching full
   * product hydration on every render.
   */
  async myCartItemCount(userId: string): Promise<number> {
    const customerId = await this.getCustomerId(userId);
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: { items: { select: { quantity: true } } },
    });
    if (!cart) return 0;
    return cart.items.reduce((s, i) => s + i.quantity, 0);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async add(userId: string, input: AddToCartInput) {
    const customerId = await this.getCustomerId(userId);
    const variant = await this.loadPurchaseableVariant(input.variantId);
    const cart = await this.getOrCreateCart(customerId);
    const qtyToAdd = input.quantity ?? 1;

    // Atomic upsert: increment if exists else create with snapshot price.
    const existing = await this.prisma.cartItem.findUnique({
      where: {
        cartId_variantId: { cartId: cart.id, variantId: variant.id },
      },
    });
    if (existing) {
      const newQty = Math.min(99, existing.quantity + qtyToAdd);
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: variant.productId,
          variantId: variant.id,
          quantity: qtyToAdd,
          unitPriceSnapshot: variant.price,
        },
      });
    }

    return this.loadHydratedCart(customerId);
  }

  async updateQty(userId: string, input: UpdateCartItemQtyInput) {
    const customerId = await this.getCustomerId(userId);
    const cart = await this.prisma.cart.findUnique({ where: { customerId } });
    if (!cart) return this.loadHydratedCart(customerId);

    const existing = await this.prisma.cartItem.findUnique({
      where: {
        cartId_variantId: { cartId: cart.id, variantId: input.variantId },
      },
    });
    if (!existing) return this.loadHydratedCart(customerId);

    if (input.quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: input.quantity },
      });
    }
    return this.loadHydratedCart(customerId);
  }

  async remove(userId: string, input: RemoveCartItemInput) {
    const customerId = await this.getCustomerId(userId);
    const cart = await this.prisma.cart.findUnique({ where: { customerId } });
    if (!cart) return this.loadHydratedCart(customerId);

    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id, variantId: input.variantId },
    });
    return this.loadHydratedCart(customerId);
  }

  async clear(userId: string) {
    const customerId = await this.getCustomerId(userId);
    const cart = await this.prisma.cart.findUnique({ where: { customerId } });
    if (!cart) return this.loadHydratedCart(customerId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.loadHydratedCart(customerId);
  }
}
