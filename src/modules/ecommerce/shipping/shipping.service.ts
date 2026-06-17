import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CouponService } from '@/modules/ecommerce/coupon/coupon.service';
import { CourierService } from '@/modules/ecommerce/courier/courier.service';
import { ShippingQuoteInput } from './dto/shipping-quote.input';
import { ShippingQuote, SellerShippingQuote } from './entities/shipping-quote.entity';
import {
  computeSellerShipping,
  isCodEligible,
  isServiceable,
  parseShippingConfig,
} from './shipping-rate';

/** Round to 2 decimal places (paise). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coupon: CouponService,
    private readonly courier: CourierService,
  ) {}

  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!customer || customer.deletedAt) {
      throw new ForbiddenException('Shipping quotes are only available to customer accounts.');
    }
    return customer.id;
  }

  /**
   * Preview shipping for the current cart. Uses the SAME pure engine as order
   * placement, so the quoted charge equals what the customer is charged. The
   * free-shipping threshold is judged on the PRE-discount subtotal (mirrors
   * placement); COD eligibility is judged on the post-discount cash total.
   */
  async quote(userId: string, input: ShippingQuoteInput): Promise<ShippingQuote> {
    const customerId = await this.getCustomerId(userId);

    // Resolve the delivery pincode (preferred from a saved address).
    let pincode = input.pincode ?? null;
    if (input.addressId) {
      const addr = await this.prisma.userAddress.findUnique({
        where: { id: input.addressId },
      });
      if (!addr || addr.userId !== userId) {
        throw new NotFoundException('Address not found.');
      }
      pincode = addr.postalCode;
    }

    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            variant: true,
            product: { include: { store: { include: { seller: true } } } },
          },
        },
      },
    });

    const empty: ShippingQuote = {
      sellers: [],
      shippingTotal: 0,
      serviceable: true,
      codEligible: true,
      grandTotal: 0,
    };
    if (!cart || cart.items.length === 0) return empty;

    // Group active items by seller|store.
    interface Group {
      sellerId: string;
      storeId: string;
      storeName: string;
      config: ReturnType<typeof parseShippingConfig>;
      items: { weight: number | null; qty: number }[];
      subtotal: number;
      taxRate: number; // representative — for coupon line validation
    }
    const groups = new Map<string, Group>();
    for (const it of cart.items) {
      if (!it.variant || it.variant.deletedAt) continue;
      if (!it.product || it.product.deletedAt || it.product.status !== 'ACTIVE') continue;
      const storeId = it.product.storeId;
      const sellerId = it.product.store.seller.id;
      const key = `${sellerId}|${storeId}`;
      if (!groups.has(key)) {
        groups.set(key, {
          sellerId,
          storeId,
          storeName: it.product.store.name,
          config: parseShippingConfig(it.product.store.shippingConfig),
          items: [],
          subtotal: 0,
          taxRate: 0,
        });
      }
      const g = groups.get(key)!;
      const weight =
        it.variant.weight != null
          ? Number(it.variant.weight)
          : it.product.weight != null
            ? Number(it.product.weight)
            : null;
      g.items.push({ weight, qty: it.quantity });
      g.subtotal = round2(g.subtotal + Number(it.variant.price) * it.quantity);
    }

    // Coupon (optional) → per-store discount so COD sees the post-discount total.
    const perStoreDiscount = new Map<string, number>();
    if (input.couponCode && input.couponCode.trim()) {
      const cartLines = cart.items
        .filter(
          (it) =>
            it.variant &&
            !it.variant.deletedAt &&
            it.product &&
            !it.product.deletedAt &&
            it.product.status === 'ACTIVE',
        )
        .map((it) => ({
          storeId: it.product.storeId,
          lineTotal: round2(Number(it.variant.price) * it.quantity),
          // taxRate only affects the coupon's inclusive-tax totals; we use
          // perStoreDiscount (allocation by lineTotal), so it's irrelevant here.
          taxRate: null,
        }));
      const result = await this.coupon.validateAndCompute({
        code: input.couponCode,
        customerId,
        cartLines,
      });
      if (result.isValid) {
        result.perStoreDiscount.forEach((v, k) => perStoreDiscount.set(k, v));
      }
    }

    const validPincode = !!pincode && /^[1-9][0-9]{5}$/.test(pincode);

    // Per seller: in-house charge first (cheap, also gives billable weight),
    // then try a LIVE courier rate (it overrides the charge). Live calls run in
    // parallel; resolveSellerRate never throws (null → in-house fallback).
    const sellers: SellerShippingQuote[] = await Promise.all(
      [...groups.values()].map(async (g) => {
        const inhouse = computeSellerShipping({
          items: g.items,
          merchandiseSubtotal: g.subtotal, // pre-discount, mirrors placement
          config: g.config,
        });
        const discount = perStoreDiscount.get(g.storeId) ?? 0;

        let shippingCharge = inhouse.shippingCharge;
        let freeApplied = inhouse.freeApplied;
        let rateSource = 'IN_HOUSE';
        let courierName: string | null = null;
        let estimatedDays: number | null = g.config.processingDays ?? null;
        let serviceable = isServiceable(g.config, pincode);

        if (validPincode) {
          const live = await this.courier.resolveSellerRate({
            sellerId: g.sellerId,
            storeId: g.storeId,
            deliveryPincode: pincode as string,
            billableWeightKg: inhouse.billableWeightKg,
            declaredValue: g.subtotal,
            cod: false, // quote shows the prepaid rate; placement re-quotes with the real method
          });
          if (live) {
            shippingCharge = live.rate;
            freeApplied = false;
            rateSource = 'LIVE';
            courierName = live.courierName;
            estimatedDays = live.estimatedDays ?? estimatedDays;
            serviceable = true;
          }
        }

        const sellerGrand = round2(g.subtotal - discount + shippingCharge);
        const codEligible = serviceable && isCodEligible(g.config, sellerGrand);

        return {
          sellerId: g.sellerId,
          storeId: g.storeId,
          storeName: g.storeName,
          merchandiseSubtotal: g.subtotal,
          shippingCharge,
          freeApplied,
          freeAbove: g.config.freeAbove ?? null,
          serviceable,
          codEligible,
          estimatedDispatchDays: estimatedDays,
          rateSource,
          courierName,
        };
      }),
    );

    let shippingTotal = 0;
    let grandTotal = 0;
    let allServiceable = true;
    let allCodEligible = true;
    for (const s of sellers) {
      const discount = perStoreDiscount.get(s.storeId) ?? 0;
      shippingTotal = round2(shippingTotal + s.shippingCharge);
      grandTotal = round2(grandTotal + s.merchandiseSubtotal - discount + s.shippingCharge);
      if (!s.serviceable) allServiceable = false;
      if (!s.codEligible) allCodEligible = false;
    }

    return {
      sellers,
      shippingTotal,
      serviceable: allServiceable,
      codEligible: allCodEligible,
      grandTotal,
    };
  }
}
