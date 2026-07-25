import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '@/prisma/prisma.service';
import {
  computePriceWithTax,
  computeTaxAmount,
} from '@/common/pricing/price-with-tax.util';
import { AddToCartInput } from './dto/add-to-cart.input';
import { UpdateCartItemQtyInput } from './dto/update-cart-item-qty.input';
import { RemoveCartItemInput } from './dto/remove-cart-item.input';
import {
  CartValidationResult,
  CartWarning,
} from './entities/cart-validation.entity';

/** Max units of a single variant in one cart line — matches the DTOs. */
const MAX_LINE_QTY = 99;

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

/**
 * Items → hydration include, shared by the customer + guest cart loaders so
 * both go through the exact same `hydrateCart` path.
 */
const CART_ITEMS_INCLUDE = {
  items: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      product: { include: PRODUCT_INCLUDE },
      // Variant.attributes is non-nullable in GraphQL — must include the
      // relation here AND flatten it in `hydrateCart` so the resolver
      // doesn't return undefined.
      variant: {
        include: {
          attributes: {
            include: { attribute: true, attributeValue: true },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

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
   * Resolves a guest cart from its opaque session token, minting a fresh cart
   * (and a new token) if `sessionToken` is absent or no longer maps to a cart.
   * Returns the cart plus the token the caller should persist in the cookie —
   * `tokenChanged` tells the resolver whether to (re)issue the cookie.
   */
  private async getOrCreateGuestCart(sessionToken?: string | null) {
    if (sessionToken) {
      const existing = await this.prisma.cart.findUnique({
        where: { sessionToken },
      });
      if (existing) {
        return { cart: existing, sessionToken, tokenChanged: false };
      }
    }
    // No usable token — mint a new opaque one. 32 random bytes hex = 64 chars,
    // the same entropy the auth tokens use.
    const fresh = randomBytes(32).toString('hex');
    const cart = await this.prisma.cart.create({
      data: { sessionToken: fresh },
    });
    return { cart, sessionToken: fresh, tokenChanged: true };
  }

  /** Re-reads a cart by id with the full item include, then hydrates it. */
  private async loadHydratedCartById(cartId: string) {
    const fresh = await this.prisma.cart.findUnique({
      where: { id: cartId },
      include: CART_ITEMS_INCLUDE,
    });
    return this.hydrateCart(fresh);
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
    // Tax rate drives priceWithTax on both the product and every variant so
    // the storefront can render tax-inclusive prices when the site setting
    // demands it. Without this, cart shows the pre-tax price even when
    // `show_price_with_tax = true`.
    const taxRate = p.tax?.rate != null ? Number(p.tax.rate) : null;
    // The stored price is the pre-tax BASE; priceWithTax adds GST on top and
    // taxAmount is the GST portion alone — matches placement + the PDP/variant
    // path. The show_price_with_tax setting only picks which one is displayed.
    const withTax = (price: number): number | null =>
      computePriceWithTax(price, taxRate);

    const variants = p.variants ?? [];
    const defaultVariant = variants[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formattedVariants = variants.map((v: any) => {
      const vPrice = Number(v.price);
      return {
        ...v,
        price: vPrice,
        priceWithTax: withTax(vPrice),
        taxAmount: computeTaxAmount(vPrice, taxRate),
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
      };
    });
    const price = defaultVariant ? Number(defaultVariant.price) : 0;
    return {
      ...p,
      price,
      priceWithTax: withTax(price),
      taxAmount: computeTaxAmount(price, taxRate),
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

        // The variant ships with the cart row independently of the product
        // include path, so we have to recompute priceWithTax here using the
        // product's tax rate. Without this, item.variant.priceWithTax is
        // null and the storefront falls back to the pre-tax price.
        const taxRate =
          it.product?.tax?.rate != null
            ? Number(it.product.tax.rate)
            : null;
        const variantPriceWithTax = computePriceWithTax(
          unitPriceCurrent,
          taxRate,
        );
        const unitTax = computeTaxAmount(unitPriceCurrent, taxRate);
        // Per-line GST = unit tax × quantity (display-only; checkout recomputes).
        const lineTaxAmount =
          unitTax != null ? Math.round(unitTax * it.quantity * 100) / 100 : null;

        return {
          ...it,
          unitPriceSnapshot,
          unitPriceCurrent,
          priceChanged,
          lineTotal,
          taxAmount: lineTaxAmount,
          availableQuantity: available,
          stockState,
          variant: it.variant
            ? {
                ...it.variant,
                price: unitPriceCurrent,
                priceWithTax: variantPriceWithTax,
                taxAmount: unitTax,
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
    return this.loadHydratedCartById(cart.id);
  }

  // ---------------------------------------------------------------------------
  // Item mutation cores — operate on an already-resolved cart row so the
  // customer + guest entry points share one implementation.
  // ---------------------------------------------------------------------------

  private async addItemToCart(
    cartId: string,
    variantId: string,
    productId: string,
    unitPrice: unknown,
    qtyToAdd: number,
  ) {
    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });
    if (existing) {
      const newQty = Math.min(MAX_LINE_QTY, existing.quantity + qtyToAdd);
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId,
          productId,
          variantId,
          quantity: Math.min(MAX_LINE_QTY, qtyToAdd),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          unitPriceSnapshot: unitPrice as any,
        },
      });
    }
  }

  private async setItemQty(cartId: string, variantId: string, quantity: number) {
    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId } },
    });
    if (!existing) return;
    if (quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: Math.min(MAX_LINE_QTY, quantity) },
      });
    }
  }

  private async removeItem(cartId: string, variantId: string) {
    await this.prisma.cartItem.deleteMany({ where: { cartId, variantId } });
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

    await this.addItemToCart(
      cart.id,
      variant.id,
      variant.productId,
      variant.price,
      input.quantity ?? 1,
    );

    return this.loadHydratedCart(customerId);
  }

  async updateQty(userId: string, input: UpdateCartItemQtyInput) {
    const customerId = await this.getCustomerId(userId);
    const cart = await this.prisma.cart.findUnique({ where: { customerId } });
    if (!cart) return this.loadHydratedCart(customerId);

    await this.setItemQty(cart.id, input.variantId, input.quantity);
    return this.loadHydratedCart(customerId);
  }

  async remove(userId: string, input: RemoveCartItemInput) {
    const customerId = await this.getCustomerId(userId);
    const cart = await this.prisma.cart.findUnique({ where: { customerId } });
    if (!cart) return this.loadHydratedCart(customerId);

    await this.removeItem(cart.id, input.variantId);
    return this.loadHydratedCart(customerId);
  }

  async clear(userId: string) {
    const customerId = await this.getCustomerId(userId);
    const cart = await this.prisma.cart.findUnique({ where: { customerId } });
    if (!cart) return this.loadHydratedCart(customerId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return this.loadHydratedCart(customerId);
  }

  // ---------------------------------------------------------------------------
  // Guest cart (cookie-scoped, unauthenticated)
  // ---------------------------------------------------------------------------
  //
  // Guest entry points return `{ cart, sessionToken, tokenChanged }`. The
  // resolver mints/refreshes the httpOnly cookie whenever `tokenChanged` is
  // true (i.e. a brand-new guest cart was created on this call).

  /** Read a guest cart by token. Returns null when the token maps to nothing. */
  async guestCartByToken(sessionToken?: string | null) {
    if (!sessionToken) return null;
    const cart = await this.prisma.cart.findUnique({ where: { sessionToken } });
    if (!cart) return null;
    return this.loadHydratedCartById(cart.id);
  }

  async addGuest(sessionToken: string | null | undefined, input: AddToCartInput) {
    const variant = await this.loadPurchaseableVariant(input.variantId);
    const { cart, sessionToken: token, tokenChanged } =
      await this.getOrCreateGuestCart(sessionToken);

    await this.addItemToCart(
      cart.id,
      variant.id,
      variant.productId,
      variant.price,
      input.quantity ?? 1,
    );

    const hydrated = await this.loadHydratedCartById(cart.id);
    return { cart: hydrated, sessionToken: token, tokenChanged };
  }

  async updateQtyGuest(
    sessionToken: string | null | undefined,
    input: UpdateCartItemQtyInput,
  ) {
    const { cart, sessionToken: token, tokenChanged } =
      await this.getOrCreateGuestCart(sessionToken);
    await this.setItemQty(cart.id, input.variantId, input.quantity);
    const hydrated = await this.loadHydratedCartById(cart.id);
    return { cart: hydrated, sessionToken: token, tokenChanged };
  }

  async removeGuest(
    sessionToken: string | null | undefined,
    input: RemoveCartItemInput,
  ) {
    const { cart, sessionToken: token, tokenChanged } =
      await this.getOrCreateGuestCart(sessionToken);
    await this.removeItem(cart.id, input.variantId);
    const hydrated = await this.loadHydratedCartById(cart.id);
    return { cart: hydrated, sessionToken: token, tokenChanged };
  }

  // ---------------------------------------------------------------------------
  // Merge-on-login
  // ---------------------------------------------------------------------------

  /**
   * Folds a guest cart into the customer's cart: for every guest line, sum the
   * quantity into the matching customer line (dedupe by variantId, capped at
   * MAX_LINE_QTY) or move the line over. The guest cart is then deleted, which
   * cascade-deletes its items. Returns the hydrated CUSTOMER cart.
   *
   * Best-effort by contract — the login path wraps this in try/catch so a merge
   * failure never blocks sign-in. Resolves the Customer.id itself so callers
   * (auth login) only need the userId + the guest token.
   */
  async mergeGuestIntoCustomer(userId: string, sessionToken?: string | null) {
    const customerId = await this.getCustomerId(userId);

    if (!sessionToken) {
      return this.loadHydratedCart(customerId);
    }

    const guestCart = await this.prisma.cart.findUnique({
      where: { sessionToken },
      include: { items: true },
    });

    // Nothing to merge — just return the (possibly empty) customer cart.
    if (!guestCart || guestCart.items.length === 0) {
      if (guestCart) {
        await this.prisma.cart
          .delete({ where: { id: guestCart.id } })
          .catch(() => undefined);
      }
      return this.loadHydratedCart(customerId);
    }

    const customerCart = await this.getOrCreateCart(customerId);

    // Existing customer lines, indexed by variant, so we can sum/dedupe.
    const existingItems = await this.prisma.cartItem.findMany({
      where: { cartId: customerCart.id },
    });
    const byVariant = new Map(existingItems.map((i) => [i.variantId, i]));

    for (const gi of guestCart.items) {
      const match = byVariant.get(gi.variantId);
      if (match) {
        const newQty = Math.min(MAX_LINE_QTY, match.quantity + gi.quantity);
        await this.prisma.cartItem.update({
          where: { id: match.id },
          data: { quantity: newQty },
        });
      } else {
        // Move the line to the customer cart, preserving its snapshot price.
        await this.prisma.cartItem.create({
          data: {
            cartId: customerCart.id,
            productId: gi.productId,
            variantId: gi.variantId,
            quantity: Math.min(MAX_LINE_QTY, gi.quantity),
            unitPriceSnapshot: gi.unitPriceSnapshot,
          },
        });
      }
    }

    // Drop the guest cart (cascade removes its items + frees the token).
    await this.prisma.cart
      .delete({ where: { id: guestCart.id } })
      .catch(() => undefined);

    return this.loadHydratedCart(customerId);
  }

  // ---------------------------------------------------------------------------
  // Validation (advisory, read-only — NEVER mutates or throws)
  // ---------------------------------------------------------------------------
  //
  // Reuses hydrateCart internals (availableQuantity / stockState / priceChanged)
  // to surface adjustable warnings on cart view + pre-checkout. This is NOT the
  // authoritative oversell guard — Phase-1's guarded stock check at order
  // placement stays the source of truth.

  async validateCustomerCart(userId: string): Promise<CartValidationResult> {
    try {
      const customerId = await this.getCustomerId(userId);
      const cart = await this.prisma.cart.findUnique({ where: { customerId } });
      if (!cart) return { valid: true, warnings: [] };
      const hydrated = await this.loadHydratedCartById(cart.id);
      return this.buildValidation(hydrated);
    } catch {
      // Non-customer accounts (admin/seller) or any transient failure — the
      // contract is advisory + never-throw, so degrade to "valid".
      return { valid: true, warnings: [] };
    }
  }

  async validateGuestCart(
    sessionToken?: string | null,
  ): Promise<CartValidationResult> {
    try {
      if (!sessionToken) return { valid: true, warnings: [] };
      const cart = await this.prisma.cart.findUnique({
        where: { sessionToken },
      });
      if (!cart) return { valid: true, warnings: [] };
      const hydrated = await this.loadHydratedCartById(cart.id);
      return this.buildValidation(hydrated);
    } catch {
      return { valid: true, warnings: [] };
    }
  }

  /** Turns a hydrated cart into the typed warning list. Pure — no I/O. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildValidation(hydrated: any): CartValidationResult {
    const warnings: CartWarning[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of hydrated?.items ?? []) {
      const name: string =
        item.product?.name ?? item.variant?.name ?? 'This item';
      const available: number = Number(item.availableQuantity ?? 0);

      // Product/variant delisted, deleted, or no longer ACTIVE → UNAVAILABLE.
      const productGone =
        !item.product ||
        item.product.deletedAt != null ||
        item.product.status !== 'ACTIVE';
      const variantGone = !item.variant || item.variant.deletedAt != null;

      if (productGone || variantGone) {
        warnings.push({
          variantId: item.variantId,
          code: 'UNAVAILABLE',
          message: `${name} is no longer available and should be removed.`,
          availableQuantity: null,
          suggestedQuantity: 0,
          oldPrice: null,
          newPrice: null,
        });
        // A gone item can't also be "reduced"/"oos"; still flag price drift
        // below is pointless, so continue to the next line.
        continue;
      }

      if (available <= 0) {
        warnings.push({
          variantId: item.variantId,
          code: 'OUT_OF_STOCK',
          message: `${name} is out of stock.`,
          availableQuantity: 0,
          suggestedQuantity: 0,
          oldPrice: null,
          newPrice: null,
        });
      } else if (available < item.quantity) {
        warnings.push({
          variantId: item.variantId,
          code: 'REDUCED_QUANTITY',
          message: `Only ${available} of ${name} left — reduce the quantity to continue.`,
          availableQuantity: available,
          suggestedQuantity: available,
          oldPrice: null,
          newPrice: null,
        });
      }

      // Price drift is orthogonal to stock — a line can warrant both.
      if (item.priceChanged) {
        warnings.push({
          variantId: item.variantId,
          code: 'PRICE_CHANGED',
          message: `The price of ${name} changed since you added it.`,
          availableQuantity: null,
          suggestedQuantity: null,
          oldPrice: Number(item.unitPriceSnapshot),
          newPrice: Number(item.unitPriceCurrent),
        });
      }
    }

    return { valid: warnings.length === 0, warnings };
  }
}
