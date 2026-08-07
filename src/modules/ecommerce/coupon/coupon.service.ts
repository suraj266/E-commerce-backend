/**
 * CouponService — admin CRUD + the load-bearing `validateAndCompute()`
 * function shared by cart preview and order placement.
 *
 * Validation order (fail fast, user-friendly messages):
 *   1. Coupon exists, not soft-deleted, isActive
 *   2. Now is between validFrom and validUntil
 *   3. storeId scope (when set) — every cart item must belong to that store
 *   4. cartSubtotal >= minimumPurchaseAmount
 *   5. Total redemptions < usageLimit
 *   6. Per-customer redemptions < usageLimitPerUser
 *
 * Discount math:
 *   - percentage:    subtotal * (value / 100), clamped by maximumDiscountAmount
 *   - fixed_amount:  min(value, subtotal)  — never gift the customer change
 *
 * Per-seller allocation:
 *   Each storeId's share of the discount is proportional to its share of
 *   the cart subtotal. Rounded to 2 decimals; the last store absorbs any
 *   sub-paisa rounding drift so the totals still tie out.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCouponInput } from './dto/create-coupon.input';
import { UpdateCouponInput } from './dto/update-coupon.input';

export interface CartLineForValidation {
  storeId: string;
  /** Pre-tax base line total = unitPrice * quantity. GST is added on top. */
  lineTotal: number;
  /**
   * GST rate as a percentage (e.g. 18 for 18% GST). 0 / null when the product
   * has no tax linked. Used to compute the customer-facing "what they actually
   * pay" total — discount lands on the line, GST recomputes on the discounted
   * taxable value per CGST Act §15(3)(a).
   */
  taxRate?: number | null;
  /**
   * Legacy snapshot flag — no longer affects coupon math (the stored price is
   * always treated as the pre-tax base; GST is always added on top). Kept for
   * backward compatibility with callers that still pass it.
   */
  priceTaxInclusive?: boolean;
}

export interface ValidateAndComputeArgs {
  code: string;
  customerId: string;
  cartLines: CartLineForValidation[];
  now?: Date;
}

export interface ValidateAndComputeSuccess {
  isValid: true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  coupon: any;
  /** Pre-tax discount (e.g. 10% × ₹100 subtotal = ₹10). */
  discountAmount: number;
  /** Pre-tax subtotal we computed the discount against. */
  subtotal: number;
  /** Tax-inclusive subtotal — sum of lineTotal × (1 + taxRate/100), pre-discount. */
  subtotalInclTax: number;
  /**
   * Effective discount on the tax-inclusive price (= subtotalInclTax − customerTotal).
   * For a single-rate cart this is `discountAmount × (1 + r)`; for mixed rates
   * it's the weighted sum across lines.
   */
  discountInclTax: number;
  /**
   * Final amount the customer pays at checkout. Equals what the order
   * placement transaction will write to Order.totalAmount.
   */
  customerTotal: number;
  /** storeId → allocated discount. Sum equals discountAmount (within ±1 paisa). */
  perStoreDiscount: Map<string, number>;
}

export interface ValidateAndComputeFailure {
  isValid: false;
  reason: string;
  discountAmount: 0;
  subtotal: number;
  subtotalInclTax: number;
  discountInclTax: 0;
  customerTotal: number;
}

export type ValidateAndComputeResult =
  | ValidateAndComputeSuccess
  | ValidateAndComputeFailure;

@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Admin CRUD
  // ---------------------------------------------------------------------------

  async list(opts: {
    search?: string | null;
    status?: 'active' | 'inactive' | 'expired' | null;
  } = {}) {
    const now = new Date();
    const where: Record<string, unknown> = { deletedAt: null };
    if (opts.search && opts.search.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (opts.status === 'active') {
      where.isActive = true;
      where.validFrom = { lte: now };
      where.validUntil = { gte: now };
    } else if (opts.status === 'inactive') {
      where.isActive = false;
    } else if (opts.status === 'expired') {
      where.validUntil = { lt: now };
    }

    const rows = await this.prisma.coupon.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { validUntil: 'asc' }],
      include: { _count: { select: { redemptions: true } } },
    });
    return rows.map(this.toSafeShape);
  }

  async getById(id: string) {
    const row = await this.prisma.coupon.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!row || row.deletedAt) {
      throw new NotFoundException('Coupon not found.');
    }
    return this.toSafeShape(row);
  }

  async create(input: CreateCouponInput) {
    if (new Date(input.validUntil) <= new Date(input.validFrom)) {
      throw new BadRequestException(
        'validUntil must be after validFrom.',
      );
    }
    if (input.discountType === 'percentage' && input.discountValue > 100) {
      throw new BadRequestException(
        'Percentage discount cannot exceed 100.',
      );
    }
    const codeUpper = input.code.toUpperCase().trim();
    const existing = await this.prisma.coupon.findUnique({
      where: { code: codeUpper },
    });
    if (existing) {
      throw new BadRequestException(
        `A coupon with code "${codeUpper}" already exists.`,
      );
    }
    const row = await this.prisma.coupon.create({
      data: {
        storeId: input.storeId ?? null,
        code: codeUpper,
        name: input.name,
        description: input.description ?? null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        minimumPurchaseAmount: input.minimumPurchaseAmount ?? null,
        maximumDiscountAmount: input.maximumDiscountAmount ?? null,
        usageLimit: input.usageLimit ?? null,
        usageLimitPerUser: input.usageLimitPerUser ?? null,
        validFrom: new Date(input.validFrom),
        validUntil: new Date(input.validUntil),
        isActive: input.isActive ?? true,
      },
      include: { _count: { select: { redemptions: true } } },
    });
    return this.toSafeShape(row);
  }

  async update(input: UpdateCouponInput) {
    const existing = await this.prisma.coupon.findUnique({
      where: { id: input.id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Coupon not found.');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    if (input.storeId !== undefined) data.storeId = input.storeId;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.discountType !== undefined) data.discountType = input.discountType;
    if (input.discountValue !== undefined) data.discountValue = input.discountValue;
    if (input.minimumPurchaseAmount !== undefined) {
      data.minimumPurchaseAmount = input.minimumPurchaseAmount;
    }
    if (input.maximumDiscountAmount !== undefined) {
      data.maximumDiscountAmount = input.maximumDiscountAmount;
    }
    if (input.usageLimit !== undefined) data.usageLimit = input.usageLimit;
    if (input.usageLimitPerUser !== undefined) {
      data.usageLimitPerUser = input.usageLimitPerUser;
    }
    if (input.validFrom !== undefined) data.validFrom = new Date(input.validFrom);
    if (input.validUntil !== undefined) data.validUntil = new Date(input.validUntil);
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const validFrom = data.validFrom ?? existing.validFrom;
    const validUntil = data.validUntil ?? existing.validUntil;
    if (new Date(validUntil) <= new Date(validFrom)) {
      throw new BadRequestException('validUntil must be after validFrom.');
    }
    const type = data.discountType ?? existing.discountType;
    const value = data.discountValue ?? Number(existing.discountValue);
    if (type === 'percentage' && Number(value) > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100.');
    }

    const row = await this.prisma.coupon.update({
      where: { id: input.id },
      data,
      include: { _count: { select: { redemptions: true } } },
    });
    return this.toSafeShape(row);
  }

  async softDelete(id: string) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Coupon not found.');
    await this.prisma.coupon.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Seller-scoped CRUD (ownership-checked)
  //
  // The admin CRUD above is permission-gated but NOT ownership-scoped, so a
  // seller must never call it. These wrappers resolve the caller → seller and
  // assert the target store/coupon belongs to a store that seller owns BEFORE
  // delegating to the shared create/update/softDelete. Ownership is enforced
  // here in the service (not just filtered in the resolver query) so a forged
  // id can never reach another seller's data.
  // ---------------------------------------------------------------------------

  /** Resolve the Seller for a user; throws if the caller isn't an active seller. */
  private async getSellerId(userId: string): Promise<string> {
    const seller = await this.prisma.seller.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!seller || seller.deletedAt) {
      throw new ForbiddenException(
        'Store coupons are only available to seller accounts.',
      );
    }
    return seller.id;
  }

  /** Assert `storeId` exists and is owned by `sellerId`. */
  private async assertStoreOwnership(
    sellerId: string,
    storeId: string,
  ): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { sellerId: true, deletedAt: true },
    });
    if (!store || store.deletedAt) {
      throw new NotFoundException('Store not found.');
    }
    if (store.sellerId !== sellerId) {
      throw new ForbiddenException('You do not own this store.');
    }
  }

  /**
   * Assert the coupon exists, is store-scoped, and its store belongs to
   * `sellerId`. Platform-wide coupons (storeId null) are never a seller's to
   * touch. Returns the coupon row.
   */
  private async assertCouponOwnership(sellerId: string, couponId: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { id: couponId },
    });
    if (!coupon || coupon.deletedAt) {
      throw new NotFoundException('Coupon not found.');
    }
    if (!coupon.storeId) {
      throw new ForbiddenException('You do not have access to this coupon.');
    }
    await this.assertStoreOwnership(sellerId, coupon.storeId);
    return coupon;
  }

  /**
   * List coupons across the caller's own stores. When `storeId` is given, it
   * must be one the caller owns (asserted) and the list is scoped to it.
   */
  async listForSeller(userId: string, storeId?: string | null) {
    const sellerId = await this.getSellerId(userId);
    const ownedStores = await this.prisma.store.findMany({
      where: { sellerId, deletedAt: null },
      select: { id: true },
    });
    const ownedStoreIds = ownedStores.map((s) => s.id);
    if (ownedStoreIds.length === 0) return [];

    let scopeIds = ownedStoreIds;
    if (storeId) {
      if (!ownedStoreIds.includes(storeId)) {
        throw new ForbiddenException('You do not own this store.');
      }
      scopeIds = [storeId];
    }

    const rows = await this.prisma.coupon.findMany({
      where: { deletedAt: null, storeId: { in: scopeIds } },
      orderBy: [{ isActive: 'desc' }, { validUntil: 'asc' }],
      include: { _count: { select: { redemptions: true } } },
    });
    return rows.map(this.toSafeShape);
  }

  /** Create a coupon scoped to one of the caller's own stores. */
  async createForSeller(userId: string, input: CreateCouponInput) {
    const sellerId = await this.getSellerId(userId);
    if (!input.storeId) {
      throw new BadRequestException(
        'A store is required — sellers can only create store-scoped coupons.',
      );
    }
    await this.assertStoreOwnership(sellerId, input.storeId);
    return this.create(input);
  }

  /** Update one of the caller's own store coupons. */
  async updateForSeller(userId: string, input: UpdateCouponInput) {
    const sellerId = await this.getSellerId(userId);
    await this.assertCouponOwnership(sellerId, input.id);
    // A seller may only re-scope a coupon to another store they own, and can
    // never detach it to platform-wide.
    if (input.storeId !== undefined) {
      if (!input.storeId) {
        throw new ForbiddenException(
          'Store coupons must stay attached to one of your stores.',
        );
      }
      await this.assertStoreOwnership(sellerId, input.storeId);
    }
    return this.update(input);
  }

  /** Soft-delete one of the caller's own store coupons. */
  async softDeleteForSeller(userId: string, id: string) {
    const sellerId = await this.getSellerId(userId);
    await this.assertCouponOwnership(sellerId, id);
    return this.softDelete(id);
  }

  // ---------------------------------------------------------------------------
  // Customer-facing validation
  // ---------------------------------------------------------------------------

  /**
   * Pure validation + math. Used by:
   *   - The customer's cart preview (no redemption row written)
   *   - The order placement transaction (re-validated, then redemption row
   *     is written inside the same tx)
   *
   * Returns a discriminated union — caller checks `isValid`. Never throws
   * on a validation miss; only throws on programmer errors.
   */
  async validateAndCompute(
    args: ValidateAndComputeArgs,
  ): Promise<ValidateAndComputeResult> {
    const now = args.now ?? new Date();
    const codeUpper = args.code.trim().toUpperCase();
    const subtotal = round2(
      args.cartLines.reduce((s, l) => s + l.lineTotal, 0),
    );
    // lineTotal is the pre-tax base; GST is always added on top to get the
    // customer-facing inclusive total (matches placement, which charges
    // base + tax universally).
    const subtotalInclTax = round2(
      args.cartLines.reduce((s, l) => {
        const rate = Number(l.taxRate ?? 0) || 0;
        return s + l.lineTotal * (1 + rate / 100);
      }, 0),
    );

    if (!codeUpper) {
      return invalid('Enter a coupon code to continue.', subtotal, subtotalInclTax);
    }
    if (args.cartLines.length === 0) {
      return invalid('Your cart is empty.', 0, 0);
    }

    const coupon = await this.prisma.coupon.findUnique({
      where: { code: codeUpper },
    });

    if (!coupon || coupon.deletedAt) {
      return invalid('This coupon code is invalid.', subtotal, subtotalInclTax);
    }
    if (!coupon.isActive) {
      return invalid('This coupon is no longer active.', subtotal, subtotalInclTax);
    }
    if (coupon.validFrom > now) {
      return invalid(
        `This coupon is not active yet. Try again on ${coupon.validFrom.toLocaleDateString()}.`,
        subtotal, subtotalInclTax,
      );
    }
    if (coupon.validUntil < now) {
      return invalid('This coupon has expired.', subtotal, subtotalInclTax);
    }

    // Scope: if storeId is set, every cart line must be from that store.
    if (coupon.storeId) {
      const offending = args.cartLines.find(
        (l) => l.storeId !== coupon.storeId,
      );
      if (offending) {
        return invalid(
          'This coupon applies to a specific store. Some items in your cart are not eligible.',
          subtotal, subtotalInclTax,
        );
      }
    }

    // Min purchase — 0 and null both mean "no minimum"
    const minPurchase = Number(coupon.minimumPurchaseAmount ?? 0);
    if (minPurchase > 0 && subtotal < minPurchase) {
      return invalid(
        `Add ₹${(minPurchase - subtotal).toFixed(0)} more to use this coupon (₹${minPurchase.toFixed(0)} minimum).`,
        subtotal, subtotalInclTax,
      );
    }

    // Usage limits — 0 OR null mean unlimited. A literal "0 uses" coupon
    // could never be redeemed; treat that data entry as "no limit set".
    if (coupon.usageLimit != null && coupon.usageLimit > 0) {
      const totalUsed = await this.prisma.couponRedemption.count({
        where: { couponId: coupon.id },
      });
      if (totalUsed >= coupon.usageLimit) {
        return invalid(
          'This coupon has reached its usage limit.',
          subtotal, subtotalInclTax,
        );
      }
    }
    if (coupon.usageLimitPerUser != null && coupon.usageLimitPerUser > 0) {
      const perUserUsed = await this.prisma.couponRedemption.count({
        where: { couponId: coupon.id, customerId: args.customerId },
      });
      if (perUserUsed >= coupon.usageLimitPerUser) {
        return invalid(
          'You have already used this coupon the maximum number of times.',
          subtotal, subtotalInclTax,
        );
      }
    }

    // Math
    let discountAmount = 0;
    if (coupon.discountType === 'percentage') {
      discountAmount = subtotal * (Number(coupon.discountValue) / 100);
      // 0 OR null = no cap. A literal "cap at zero" would be useless and is
      // almost always a "user meant unlimited" data-entry mistake.
      const maxCap = Number(coupon.maximumDiscountAmount ?? 0);
      if (maxCap > 0) {
        discountAmount = Math.min(discountAmount, maxCap);
      }
    } else if (coupon.discountType === 'fixed_amount') {
      discountAmount = Math.min(Number(coupon.discountValue), subtotal);
    } else {
      this.logger.error(
        `Unknown discountType "${coupon.discountType}" on coupon ${coupon.code}`,
      );
      return invalid('This coupon is misconfigured.', subtotal, subtotalInclTax);
    }

    discountAmount = round2(discountAmount);
    if (discountAmount <= 0) {
      return invalid(
        "Looks like this coupon wouldn't apply any discount to your cart.",
        subtotal, subtotalInclTax,
      );
    }

    // Per-store allocation — proportional to each store's share of subtotal.
    // The last store eats any rounding drift so allocations sum exactly.
    const perStoreDiscount = new Map<string, number>();
    const perStoreSubtotal = new Map<string, number>();
    for (const l of args.cartLines) {
      perStoreSubtotal.set(
        l.storeId,
        (perStoreSubtotal.get(l.storeId) ?? 0) + l.lineTotal,
      );
    }
    const storeIds = [...perStoreSubtotal.keys()];
    let allocated = 0;
    for (let i = 0; i < storeIds.length; i++) {
      const sid = storeIds[i];
      let share: number;
      if (i === storeIds.length - 1) {
        share = round2(discountAmount - allocated);
      } else {
        const storeShare = perStoreSubtotal.get(sid)! / subtotal;
        share = round2(discountAmount * storeShare);
        allocated += share;
      }
      perStoreDiscount.set(sid, share);
    }

    // ---- Customer-facing tax math ----
    // For each line: lineDiscount allocated proportionally inside its store,
    // then customer pays (lineSubtotal - lineDiscount) * (1 + r/100).
    // Mirrors what OrderPlacementService computes at placement time.
    let customerTotal = 0;
    const perStoreAllocated = new Map<string, number>();
    for (const sid of storeIds) perStoreAllocated.set(sid, 0);
    for (let li = 0; li < args.cartLines.length; li++) {
      const l = args.cartLines[li];
      const storeSub = perStoreSubtotal.get(l.storeId)!;
      const storeAllot = perStoreDiscount.get(l.storeId) ?? 0;
      const isLastLineInStore = !args.cartLines
        .slice(li + 1)
        .some((next) => next.storeId === l.storeId);
      let lineDiscount: number;
      if (isLastLineInStore) {
        lineDiscount = round2(
          storeAllot - (perStoreAllocated.get(l.storeId) ?? 0),
        );
      } else if (storeSub > 0) {
        lineDiscount = round2((storeAllot * l.lineTotal) / storeSub);
        perStoreAllocated.set(
          l.storeId,
          (perStoreAllocated.get(l.storeId) ?? 0) + lineDiscount,
        );
      } else {
        lineDiscount = 0;
      }
      // lineTotal is the pre-tax base: the customer pays the discounted base
      // plus GST on the discounted base (matches placement).
      const taxRate = Number(l.taxRate ?? 0) || 0;
      const netLine = Math.max(0, l.lineTotal - lineDiscount);
      customerTotal += netLine + (netLine * taxRate) / 100;
    }
    customerTotal = round2(customerTotal);
    const discountInclTax = round2(subtotalInclTax - customerTotal);

    return {
      isValid: true,
      coupon,
      discountAmount,
      subtotal,
      subtotalInclTax,
      discountInclTax,
      customerTotal,
      perStoreDiscount,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toSafeShape = (row: any) => ({
    id: row.id,
    storeId: row.storeId,
    code: row.code,
    name: row.name,
    description: row.description,
    discountType: row.discountType,
    discountValue: Number(row.discountValue),
    minimumPurchaseAmount:
      row.minimumPurchaseAmount != null
        ? Number(row.minimumPurchaseAmount)
        : null,
    maximumDiscountAmount:
      row.maximumDiscountAmount != null
        ? Number(row.maximumDiscountAmount)
        : null,
    usageLimit: row.usageLimit,
    usageLimitPerUser: row.usageLimitPerUser,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    isActive: row.isActive,
    redemptionCount: row._count?.redemptions ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Failure result. `subtotalInclTax` defaults to `subtotal` for "no-cart" or
 * "no-tax-known" callsites; pass an explicit tax-inclusive subtotal when one
 * has been computed so the UI can still render the correct grand total.
 */
function invalid(
  reason: string,
  subtotal: number,
  subtotalInclTax?: number,
): ValidateAndComputeFailure {
  const incl = subtotalInclTax ?? subtotal;
  return {
    isValid: false,
    reason,
    discountAmount: 0,
    subtotal,
    subtotalInclTax: incl,
    discountInclTax: 0,
    customerTotal: incl,
  };
}
