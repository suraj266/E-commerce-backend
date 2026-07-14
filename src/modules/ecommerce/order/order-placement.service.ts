/**
 * =============================================================================
 * OrderPlacementService — the place-order transaction.
 * =============================================================================
 *
 * Pulled into its own service because the placement logic is significantly
 * heavier than the rest of OrderService and benefits from being read in
 * isolation. Onboarding devs: this file IS the order pipeline.
 *
 * High-level flow:
 *
 *   1. Resolve customer from JWT
 *   2. Load + validate cart (must be non-empty, products still active)
 *   3. Load + validate addresses (must belong to current user)
 *   4. Per-variant stock check (sum across warehouses ≥ quantity)
 *   5. Plan inventory deductions (which warehouse(s) supply each variant)
 *   6. Group cart items by store/seller → sub-order plans
 *   7. Compute totals: subtotal, tax (from Product.tax.rate), shipping=0
 *      for v1, discount=0 for v1, total. Per seller: commission +
 *      payout split.
 *   8. In ONE Prisma transaction:
 *        a. Create Order
 *        b. Create one SellerOrder per group
 *        c. Create OrderItem rows (snapshot sku/name/price/attrs)
 *        d. Insert initial PENDING entries in OrderStatusHistory
 *        e. For every (variant, warehouse) deduction: update Inventory
 *           (qtyAvailable -= n; qtyReserved += n) and write an
 *           InventoryMovement with referenceType='order'.
 *        f. Empty the cart (delete CartItems, keep Cart row)
 *   9. Return the hydrated Order.
 *
 * Failure modes that abort the WHOLE transaction:
 *   - Cart is empty
 *   - Address doesn't belong to caller
 *   - A variant doesn't exist or product is no longer ACTIVE
 *   - Total available stock < requested for any variant
 *   - Any DB write fails
 *
 * What's intentionally NOT done here (for v1):
 *   - Real payment gateway. paymentMethod=COD is the only live path;
 *     paymentStatus stays PENDING until seller marks paid (or Sprint 4
 *     wires Razorpay/Stripe).
 *   - Coupons / discounts (architectural docs cover but no Prisma yet).
 *   - Email notifications (Sprint 5).
 *   - Cross-warehouse split-shipment beyond same SellerOrder.
 * =============================================================================
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
} from '@prisma/client';
import { Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { CouponService } from '@/modules/ecommerce/coupon/coupon.service';
import { config } from '@/common/config/config';
import { PlaceOrderInput } from './dto/place-order.input';
import { generateOrderNumber } from './order.helpers';
import { isIdempotencyConflict } from './order-idempotency.util';
import { ORDER_INCLUDE, hydrateOrder } from './order.hydrate';
import {
  fromInclusiveMrp,
  getTaxKind,
  splitTax,
  type TaxBreakup,
  type TaxKind,
} from '@/modules/ecommerce/tax/place-of-supply';
import {
  computeSellerShipping,
  isCodEligible,
  isServiceable,
  parseShippingConfig,
  type ShippingConfig,
} from '@/modules/ecommerce/shipping/shipping-rate';
import {
  CourierService,
  type ResolvedRate,
} from '@/modules/ecommerce/courier/courier.service';
import { resolveState, GST_STATES } from '@/common/constants/gst-states';

interface InventoryDeduction {
  inventoryId: string;
  warehouseId: string;
  quantity: number;
  before: number;
  after: number;
}

interface PlannedItem {
  variantId: string;
  productId: string;
  storeId: string;
  sellerId: string;
  sku: string;
  name: string;
  variantName: string | null;
  quantity: number;
  /**
   * Stored unit price as set by the seller. Interpretation depends on
   * `priceTaxInclusive` — when true (default in Phase 1), this is MRP
   * (customer-facing); when false, this is the pre-tax taxable value.
   */
  unitPrice: number;
  /** % GST rate from Product.tax.rate (0–100). */
  taxRate: number;
  /** Per-unit weight (kg) — variant ?? product ?? null (→ default at calc). */
  weight: number | null;
  /** True when stored price already includes GST (Indian retail default). */
  priceTaxInclusive: boolean;
  /** HSN code snapshot for the tax invoice (Rule 46). */
  hsnCode: string | null;
  /** ISO 3166-1 alpha-2 country of origin snapshot. */
  countryOfOrigin: string | null;
  attributesSnapshot: { attributeName: string; value: string }[];
  imageUrlSnapshot: string | null;
  deductions: InventoryDeduction[];
}

/** Format a numeric amount as INR for email bodies. ₹1,49,500 etc. */
function formatRupees(amount: number): string {
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${Math.round(amount).toLocaleString('en-IN')}`;
  }
}

@Injectable()
export class OrderPlacementService {
  private readonly logger = new Logger(OrderPlacementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly coupon: CouponService,
    private readonly courier: CourierService,
  ) {}

  // ---------------------------------------------------------------------------
  // Identity helpers (same pattern as cart/wishlist — customer-only)
  // ---------------------------------------------------------------------------

  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!customer) {
      throw new ForbiddenException(
        'Checkout is only available to customer accounts.',
      );
    }
    if (customer.deletedAt) {
      throw new ForbiddenException('This account has been archived.');
    }
    return customer.id;
  }

  // ---------------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------------

  async placeOrder(
    userId: string,
    input: PlaceOrderInput,
    paymentStatus: PaymentStatus = PaymentStatus.PENDING,
    opts: { allowPrepaid?: boolean } = {},
  ) {
    // The raw placeOrder path may only place COD orders. Prepaid orders MUST
    // go through PaymentService.initiateCheckout (which opens a payment session
    // and sets AWAITING_PAYMENT) — otherwise a client could get a fully-placed
    // prepaid order with reserved stock and no payment. initiateCheckout opts in
    // with { allowPrepaid: true }.
    if (!opts.allowPrepaid && input.paymentMethod !== PaymentMethod.COD) {
      throw new BadRequestException(
        'Only Cash on Delivery can be placed directly; choose an online payment method at checkout.',
      );
    }

    const customerId = await this.getCustomerId(userId);

    // Idempotent replay: if this exact checkout attempt (same clientRequestId)
    // already produced an order, return it instead of creating a duplicate and
    // double-reserving stock.
    if (input.clientRequestId) {
      const existing = await this.prisma.order.findUnique({
        where: {
          customerId_idempotencyKey: {
            customerId,
            idempotencyKey: input.clientRequestId,
          },
        },
        include: ORDER_INCLUDE,
      });
      if (existing) return hydrateOrder(existing);
    }

    // ---- Step 1: Load cart with items + product/variant + tax ---------------
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            variant: {
              include: {
                attributes: {
                  include: { attribute: true, attributeValue: true },
                },
              },
            },
            product: {
              include: {
                tax: true,
                store: { include: { seller: true } },
                images: { orderBy: { displayOrder: 'asc' as const } },
              },
            },
          },
        },
      },
    });
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Your cart is empty.');
    }

    // ---- Step 2: Validate addresses ----------------------------------------
    const shippingAddress = await this.prisma.userAddress.findUnique({
      where: { id: input.shippingAddressId },
    });
    if (!shippingAddress || shippingAddress.userId !== userId) {
      throw new NotFoundException('Shipping address not found.');
    }
    let billingAddress = shippingAddress;
    if (
      input.billingAddressId &&
      input.billingAddressId !== input.shippingAddressId
    ) {
      const b = await this.prisma.userAddress.findUnique({
        where: { id: input.billingAddressId },
      });
      if (!b || b.userId !== userId) {
        throw new NotFoundException('Billing address not found.');
      }
      billingAddress = b;
    }

    // ---- Step 3: Validate products + plan inventory deductions -------------
    const planned: PlannedItem[] = [];
    for (const it of cart.items) {
      if (!it.variant || it.variant.deletedAt) {
        throw new BadRequestException(
          `Variant ${it.variantId} is no longer available.`,
        );
      }
      if (
        !it.product ||
        it.product.deletedAt ||
        it.product.status !== 'ACTIVE'
      ) {
        throw new BadRequestException(
          `"${it.product?.name ?? 'A product'}" is no longer available.`,
        );
      }
      const deductions = await this.planInventoryDeductions(
        it.variantId,
        it.quantity,
      );

      const variantName =
        (it.variant.attributes ?? [])
          .map((a) => a.attributeValue?.value)
          .filter(Boolean)
          .join(' / ') || null;
      const attributesSnapshot = (it.variant.attributes ?? []).map((a) => ({
        attributeName: a.attribute?.name ?? '',
        value: a.attributeValue?.value ?? '',
      }));
      const primaryImage =
        it.product.images?.find((img) => img.isPrimary) ??
        it.product.images?.[0] ??
        null;
      const imageUrlSnapshot =
        it.variant.imageUrl ?? primaryImage?.imageUrl ?? null;

      planned.push({
        variantId: it.variantId,
        productId: it.productId,
        storeId: it.product.storeId,
        sellerId: it.product.store.seller.id,
        sku: it.variant.sku,
        name: it.product.name,
        variantName,
        quantity: it.quantity,
        unitPrice: Number(it.variant.price),
        taxRate: it.product.tax ? Number(it.product.tax.rate) : 0,
        weight:
          it.variant.weight != null
            ? Number(it.variant.weight)
            : it.product.weight != null
              ? Number(it.product.weight)
              : null,
        priceTaxInclusive: it.product.isPriceTaxInclusive !== false,
        hsnCode: it.product.hsnCode ?? null,
        countryOfOrigin: it.product.countryOfOrigin ?? null,
        attributesSnapshot,
        imageUrlSnapshot,
        deductions,
      });
    }

    // ---- Resolve place-of-supply once for the whole order ------------------
    // Buyer state comes from the shipping address. We canonicalise via
    // GST_STATES so a stray "MH" / "Maharashtra" / "27" all collapse to
    // the same code. Throws BadRequest with a clear hint if unresolvable —
    // the customer is prompted to update their address.
    const buyerState = resolveState(shippingAddress.state);
    if (!buyerState) {
      throw new BadRequestException(
        `Cannot determine state from shipping address "${shippingAddress.state}". ` +
          `Please pick a valid Indian state on your saved address.`,
      );
    }
    const buyerStateCode = buyerState.code;
    const buyerStateName = buyerState.name;

    // ---- Step 4: Group by seller, compute totals ---------------------------
    const groups = new Map<string, PlannedItem[]>();
    for (const p of planned) {
      const key = `${p.sellerId}|${p.storeId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const orderId = randomUUID();
    const orderNumberSuffix = generateOrderNumber('ORD').replace('ORD-', '');
    const parentOrderNumber = `ORD-${orderNumberSuffix}`;

    // ---- Step 4a: Per-line math + per-seller PoS resolution ----------------
    // `lineSubtotal` is the customer-facing line value used for coupon
    // apportionment + the customer-facing parent subtotal. For tax-inclusive
    // catalogs that's the MRP × qty; for exclusive ones it's pre-tax × qty.
    // `lineTaxable` is the pre-tax taxable value used for the GST calc and
    // is back-calculated from MRP when the product is inclusive.
    interface LineMath {
      lineSubtotal: number; // customer-facing (MRP*qty for inclusive)
      lineTaxable: number; // pre-tax taxable value (taxable before discount)
      lineDiscount: number; // share of the coupon's per-store discount
      lineTaxableAfter: number; // taxable - discount, fed into splitTax()
      breakup: TaxBreakup; // CGST/SGST or IGST breakdown for this line
    }
    const lineMaths: LineMath[][] = []; // parallel to sellerOrderRows order

    const sellerOrderRows: {
      id: string;
      sellerId: string;
      storeId: string;
      storeName: string;
      orderNumber: string;
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      commissionAmount: number;
      payoutAmount: number;
      /** Composite-supply shipping charge (tax-inclusive). Filled in step 4c. */
      shippingAmount: number;
      /** Pre-tax taxable value of the shipping charge. Filled in step 4c. */
      shippingTaxable: number;
      /** Shipping GST split (CGST/SGST or IGST). Filled in step 4c. */
      shippingBreakup: TaxBreakup;
      /** Courier snapshot ('LIVE'|'IN_HOUSE' + selected courier). Filled in step 4c. */
      shippingRateSource: string;
      liveRate: ResolvedRate | null;
      billableWeightKg: number;
      commissionRate: number;
      /** Seller's GST state code, used to derive tax kind for every line. */
      sellerStateCode: string;
      taxKind: TaxKind;
      /** Parsed per-store shipping config (rates + COD + serviceability). */
      shippingConfig: ShippingConfig;
      items: PlannedItem[];
    }[] = [];

    for (const [, items] of groups) {
      // Seller-level data: commission rate + GST state. The Store-level state
      // overrides Seller-level if set (a single legal entity can register
      // separately in multiple states). Throws if neither is set — a
      // seller without state cannot legally invoice from this platform.
      const [seller, store] = await Promise.all([
        this.prisma.seller.findUnique({
          where: { id: items[0].sellerId },
          select: { commissionRate: true, stateCode: true },
        }),
        this.prisma.store.findUnique({
          where: { id: items[0].storeId },
          select: { stateCode: true, name: true, shippingConfig: true },
        }),
      ]);
      const commissionRate = Number(seller?.commissionRate ?? 0);
      const sellerStateCode = store?.stateCode || seller?.stateCode || null;
      if (!sellerStateCode) {
        throw new BadRequestException(
          `Seller is missing a GST state and cannot accept orders yet. ` +
            `Please contact platform support.`,
        );
      }
      const taxKind = getTaxKind(sellerStateCode, buyerStateCode);
      const shippingConfig = parseShippingConfig(store?.shippingConfig);

      const itemMaths: LineMath[] = items.map((it) => {
        const lineGross = it.unitPrice * it.quantity;
        // The stored unitPrice is always the pre-tax BASE, so the taxable value
        // is the gross itself — GST is added on top (never back-calculated out).
        const lineTaxable = lineGross;
        return {
          lineSubtotal: round2(lineGross),
          lineTaxable,
          lineDiscount: 0,
          lineTaxableAfter: lineTaxable,
          // Placeholder breakup; filled in step 4c after coupon allocation.
          breakup: splitTax(0, it.taxRate, taxKind),
        };
      });
      const soSubtotal = itemMaths.reduce((s, m) => s + m.lineSubtotal, 0);

      sellerOrderRows.push({
        id: randomUUID(),
        sellerId: items[0].sellerId,
        storeId: items[0].storeId,
        storeName: store?.name ?? 'the seller',
        orderNumber: `SORD-${orderNumberSuffix}`,
        subtotal: round2(soSubtotal),
        taxAmount: 0, // filled in step 4c
        discountAmount: 0, // filled in step 4c
        commissionAmount: 0, // filled in step 4c
        payoutAmount: 0, // filled in step 4c
        shippingAmount: 0, // filled in step 4c
        shippingTaxable: 0, // filled in step 4c
        shippingBreakup: splitTax(0, 0, taxKind), // filled in step 4c
        shippingRateSource: 'IN_HOUSE', // filled in step 4c
        liveRate: null, // filled in step 4b.1
        billableWeightKg: 0, // filled in step 4b.1
        sellerStateCode,
        taxKind,
        shippingConfig,
        commissionRate,
        items,
      });
      lineMaths.push(itemMaths);
    }

    // SellerOrder.orderNumber is unique — disambiguate if 2+ sub-orders.
    if (sellerOrderRows.length > 1) {
      sellerOrderRows.forEach((row, idx) => {
        row.orderNumber = `SORD-${orderNumberSuffix}-${idx + 1}`;
      });
    }

    // ---- Step 4b: Coupon validation -----------------------------------------
    // GST-correct treatment: a coupon applied at the time of supply is an
    // "invoice discount" under CGST Act §15(3)(a) — it reduces each line's
    // taxable value, and GST is computed on the discounted base. The seller's
    // taxable supply is therefore the post-discount amount, which is also
    // what commission + payout compute against.
    let couponDiscount = 0;
    let appliedCouponId: string | null = null;
    let appliedCouponCode: string | null = null;
    const perStoreDiscount = new Map<string, number>();
    if (input.couponCode && input.couponCode.trim()) {
      const cartLines = sellerOrderRows.flatMap((so, i) =>
        lineMaths[i].map((m, j) => ({
          storeId: so.storeId,
          lineTotal: m.lineSubtotal,
          taxRate: so.items[j].taxRate,
          priceTaxInclusive: so.items[j].priceTaxInclusive,
        })),
      );
      const result = await this.coupon.validateAndCompute({
        code: input.couponCode,
        customerId,
        cartLines,
      });
      if (!result.isValid) {
        throw new BadRequestException(result.reason);
      }
      couponDiscount = result.discountAmount;
      appliedCouponId = result.coupon.id;
      appliedCouponCode = result.coupon.code;
      result.perStoreDiscount.forEach((v, k) => perStoreDiscount.set(k, v));
    }

    // ---- Step 4c: Per-line discount + tax-on-discounted-base ----------------
    // For each seller-order: allocate the store's coupon discount across its
    // lines proportionally to `lineSubtotal` (customer-facing — this is the
    // same denominator used by CouponService when it computed the per-store
    // allotment, so allocations remain consistent end-to-end). The last
    // line absorbs any rounding drift so the sum ties exactly to the
    // store's allotment.
    //
    // Tax is then computed on the post-discount TAXABLE value (back-calc
    // from MRP for inclusive products), with the CGST/SGST or IGST split
    // determined by the seller-order's taxKind.
    let parentSubtotal = 0;
    let parentTax = 0;
    let parentDiscount = 0;
    let parentShipping = 0;
    let parentShippingTax = 0;

    // ---- Step 4b.1: Pre-fetch LIVE courier rates (parallel, pre-transaction).
    // Each seller with an enabled courier account gets a live rate; a null
    // result (no account / error / timeout) falls back to the in-house engine.
    // This MUST stay outside the $transaction — external HTTP must never hold
    // a DB connection. `resolveSellerRate` never throws.
    await Promise.all(
      sellerOrderRows.map(async (so) => {
        const billable = computeSellerShipping({
          items: so.items.map((it) => ({
            weight: it.weight,
            qty: it.quantity,
          })),
          merchandiseSubtotal: so.subtotal,
          config: so.shippingConfig,
        }).billableWeightKg;
        so.billableWeightKg = billable;
        so.liveRate = await this.courier.resolveSellerRate({
          sellerId: so.sellerId,
          storeId: so.storeId,
          deliveryPincode: shippingAddress.postalCode,
          billableWeightKg: billable,
          declaredValue: so.subtotal,
          cod: input.paymentMethod === PaymentMethod.COD,
        });
      }),
    );

    for (let i = 0; i < sellerOrderRows.length; i++) {
      const so = sellerOrderRows[i];
      const items = so.items;
      const maths = lineMaths[i];
      const storeDiscount = perStoreDiscount.get(so.storeId) ?? 0;

      let allocated = 0;
      let soTax = 0;
      for (let j = 0; j < items.length; j++) {
        const m = maths[j];
        const it = items[j];
        let lineDiscount: number;
        if (j === items.length - 1) {
          lineDiscount = round2(storeDiscount - allocated);
        } else if (so.subtotal > 0) {
          lineDiscount = round2((storeDiscount * m.lineSubtotal) / so.subtotal);
          allocated += lineDiscount;
        } else {
          lineDiscount = 0;
        }
        // The stored price is the pre-tax base, so lineSubtotal == lineTaxable
        // and the coupon discount applies 1:1 to the taxable value (§15(3)(a)).
        const lineDiscountTaxable = lineDiscount;
        const taxableAfter = Math.max(0, m.lineTaxable - lineDiscountTaxable);

        const breakup = splitTax(taxableAfter, it.taxRate, so.taxKind);

        m.lineDiscount = lineDiscount;
        m.lineTaxableAfter = taxableAfter;
        m.breakup = breakup;
        soTax += breakup.totalTax;
      }

      // soTaxableValue = sum of post-discount taxable values (pre-tax).
      // Commission contractually applies to the seller's GST-recognised
      // taxable supply, NOT the customer-facing MRP, regardless of pricing
      // mode — keeps the seller's effective commission identical across
      // inclusive vs exclusive catalogs.
      const soTaxableValue = maths.reduce((s, m) => s + m.lineTaxableAfter, 0);
      const commissionAmount = round2(
        (soTaxableValue * so.commissionRate) / 100,
      );

      // ---- Shipping (composite supply, CGST §8 / Decision D7) -------------
      // Charge from the per-store rate engine (same pure fn as the preview
      // quote, so what the customer saw == what they pay). Free-threshold is
      // judged on the PRE-discount subtotal so a coupon can't silently revoke
      // free shipping. The charge is tax-INCLUSIVE; its GST is back-calculated
      // at the PRINCIPAL supply's rate — the highest post-discount-taxable
      // line in this seller-order.
      let principalRate = 0;
      let maxTaxable = -1;
      for (let j = 0; j < items.length; j++) {
        if (maths[j].lineTaxableAfter > maxTaxable) {
          maxTaxable = maths[j].lineTaxableAfter;
          principalRate = items[j].taxRate;
        }
      }
      // Live courier rate (pre-fetched) wins; else the in-house flat engine.
      // ONLY the source of `shippingCharge` changes — the composite-supply GST
      // back-calc below is identical for both (the rate is tax-inclusive).
      const inhouse = computeSellerShipping({
        items: items.map((it) => ({ weight: it.weight, qty: it.quantity })),
        merchandiseSubtotal: so.subtotal, // pre-discount, customer-facing
        config: so.shippingConfig,
      });
      const shippingCharge = so.liveRate
        ? so.liveRate.rate
        : inhouse.shippingCharge;
      so.shippingRateSource = so.liveRate ? 'LIVE' : 'IN_HOUSE';
      let shippingTaxable = 0;
      let shippingBreakup = splitTax(0, principalRate, so.taxKind);
      if (shippingCharge > 0) {
        shippingTaxable = fromInclusiveMrp(shippingCharge, principalRate);
        shippingBreakup = splitTax(shippingTaxable, principalRate, so.taxKind);
      }
      const shippingTax = shippingBreakup.totalTax;

      // Payout = merchandise (taxable + GST − commission) + FULL shipping
      // charge (taxable + its GST). Shipping revenue accrues to the seller to
      // pay the courier; commission stays on the MERCHANDISE base only.
      const payoutAmount = round2(
        soTaxableValue +
          soTax -
          commissionAmount +
          shippingTaxable +
          shippingTax,
      );

      so.taxAmount = round2(soTax + shippingTax); // full GST incl. shipping
      so.discountAmount = round2(storeDiscount);
      so.commissionAmount = commissionAmount;
      so.payoutAmount = payoutAmount;
      so.shippingAmount = shippingCharge;
      so.shippingTaxable = round2(shippingTaxable);
      so.shippingBreakup = shippingBreakup;

      parentSubtotal += so.subtotal;
      parentTax += so.taxAmount;
      parentDiscount += so.discountAmount;
      parentShipping += so.shippingAmount;
      parentShippingTax += shippingTax;
    }

    // Customer-facing total. The stored price is the pre-tax base, so the
    // MERCHANDISE tax is always added on top: parentTax − parentShippingTax
    // (parentTax also carries the shipping GST). Shipping is added as a single
    // TAX-INCLUSIVE line (parentShipping already contains its own GST), so we
    // never add parentShippingTax again — that would double-count it.
    const merchandiseTax = round2(parentTax - parentShippingTax);
    const totalAmount = round2(
      parentSubtotal + merchandiseTax - parentDiscount + parentShipping,
    );
    couponDiscount = round2(parentDiscount); // tie out exactly to per-store sum

    // ---- Step 4d: Serviceability + COD eligibility guard --------------------
    // Validated AFTER shipping is computed so the COD limit sees the real
    // cash-collected amount (subtotal − discount + shipping) per seller.
    // When a LIVE courier rate was found, serviceability + COD were already
    // confirmed by the courier (pickCourier filters non-serviceable / non-COD),
    // so only the IN-HOUSE fallback path applies the static guards.
    for (const so of sellerOrderRows) {
      if (so.liveRate) continue;
      if (!isServiceable(so.shippingConfig, shippingAddress.postalCode)) {
        throw new BadRequestException(
          `${so.storeName} does not deliver to PIN ${shippingAddress.postalCode}.`,
        );
      }
      if (input.paymentMethod === PaymentMethod.COD) {
        const sellerGrandTotal = round2(
          so.subtotal - so.discountAmount + so.shippingAmount,
        );
        if (!isCodEligible(so.shippingConfig, sellerGrandTotal)) {
          throw new BadRequestException(
            `Cash on Delivery is not available for items from ${so.storeName} on this order.`,
          );
        }
      }
    }

    // ---- Step 5: One transaction commits everything ------------------------
    try {
      await this.prisma.$transaction(async (tx) => {
        // (a) parent Order — also captures place-of-supply (CGST §12 trail)
        //     and optional buyer GSTIN (B2B invoice flag) for downstream
        //     invoice rendering.
        await tx.order.create({
          data: {
            id: orderId,
            orderNumber: parentOrderNumber,
            customerId,
            status: OrderStatus.PENDING,
            paymentStatus,
            paymentMethod: input.paymentMethod,
            subtotal: round2(parentSubtotal),
            taxAmount: round2(parentTax),
            shippingAmount: round2(parentShipping),
            discountAmount: round2(couponDiscount),
            totalAmount: round2(totalAmount),
            currencyCode: 'INR',
            couponId: appliedCouponId,
            couponCode: appliedCouponCode,
            shippingAddressId: shippingAddress.id,
            billingAddressId: billingAddress.id,
            customerNotes: input.customerNotes ?? null,
            buyerGstin: input.buyerGstin?.toUpperCase() ?? null,
            placeOfSupplyStateCode: buyerStateCode,
            placeOfSupplyStateName: buyerStateName,
            // Idempotency key (nullable) — the @@unique([customerId, idempotencyKey])
            // constraint makes a concurrent duplicate submit fail with P2002, which
            // the caller catches and resolves to the winning order.
            idempotencyKey: input.clientRequestId ?? null,
          },
        });

        // (a.1) Coupon redemption row — unique on orderId, guarantees idempotency.
        if (appliedCouponId) {
          await tx.couponRedemption.create({
            data: {
              couponId: appliedCouponId,
              orderId,
              customerId,
              discountAmount: round2(couponDiscount),
            },
          });
        }

        // (b) SellerOrders + (c) OrderItems + (d) status history
        for (let i = 0; i < sellerOrderRows.length; i++) {
          const so = sellerOrderRows[i];
          const maths = lineMaths[i];
          await tx.sellerOrder.create({
            data: {
              id: so.id,
              orderId,
              sellerId: so.sellerId,
              storeId: so.storeId,
              orderNumber: so.orderNumber,
              status: OrderStatus.PENDING,
              paymentStatus,
              subtotal: so.subtotal,
              taxAmount: so.taxAmount,
              shippingAmount: so.shippingAmount,
              discountAmount: so.discountAmount,
              commissionAmount: so.commissionAmount,
              payoutAmount: so.payoutAmount,
              currencyCode: 'INR',
              // Persisted shipping tax breakup (composite supply) — the invoice
              // reads these so its CGST/SGST/IGST totals tie to the grand total
              // without recomputing the principal rate.
              shippingTaxableValue: so.shippingTaxable,
              shippingCgstAmount: so.shippingBreakup.cgstAmount,
              shippingSgstAmount: so.shippingBreakup.sgstAmount,
              shippingIgstAmount: so.shippingBreakup.igstAmount,
              // Courier snapshot — so ship-time reuses the quoted courier.
              shippingRateSource: so.shippingRateSource,
              shippingProvider: so.liveRate?.provider ?? null,
              selectedCourierId: so.liveRate?.courierId ?? null,
              selectedCourierName: so.liveRate?.courierName ?? null,
              quotedShippingRate: so.liveRate?.rate ?? null,
              billableWeightKg: so.billableWeightKg,
              // Mirror parent PoS — invoice rendering reads from SellerOrder
              // so it can avoid the join.
              placeOfSupplyStateCode: buyerStateCode,
              placeOfSupplyStateName: buyerStateName,
              taxKind: so.taxKind,
            },
          });

          for (let j = 0; j < so.items.length; j++) {
            const it = so.items[j];
            const m = maths[j];
            await tx.orderItem.create({
              data: {
                orderId,
                sellerOrderId: so.id,
                productId: it.productId,
                variantId: it.variantId,
                storeId: it.storeId,
                sku: it.sku,
                name: it.name,
                variantName: it.variantName,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                // totalPrice = customer-facing line value (pre-discount) =
                // pre-tax base × qty. The customer's parent subtotal sums these;
                // GST is added on top at the order level.
                totalPrice: round2(m.lineSubtotal),
                // Legacy aggregate field — kept in sync with sum of breakup.
                taxAmount: round2(m.breakup.totalTax),
                discountAmount: m.lineDiscount,
                attributesSnapshot:
                  it.attributesSnapshot as unknown as Prisma.InputJsonValue,
                imageUrlSnapshot: it.imageUrlSnapshot,
                // Compliance snapshots: pinned for the lifetime of the order
                // regardless of subsequent product edits.
                hsnCode: it.hsnCode,
                countryOfOrigin: it.countryOfOrigin,
                priceTaxInclusive: it.priceTaxInclusive,
                taxableValue: m.lineTaxableAfter,
                cgstRate: m.breakup.cgstRate,
                cgstAmount: m.breakup.cgstAmount,
                sgstRate: m.breakup.sgstRate,
                sgstAmount: m.breakup.sgstAmount,
                igstRate: m.breakup.igstRate,
                igstAmount: m.breakup.igstAmount,
                cessRate: m.breakup.cessRate,
                cessAmount: m.breakup.cessAmount,
              },
            });
          }

          await tx.orderStatusHistory.create({
            data: {
              sellerOrderId: so.id,
              toStatus: OrderStatus.PENDING,
              changedById: userId,
              notes: 'Order placed',
            },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            orderId,
            toStatus: OrderStatus.PENDING,
            changedById: userId,
            notes: 'Order placed',
          },
        });

        // (e) Inventory deductions: qtyAvailable → qtyReserved + movements.
        //
        // Flatten every deduction and sort by inventoryId so concurrent orders
        // always take row locks in the same global order (deadlock avoidance).
        // Each decrement is CONDITIONAL — `WHERE quantityAvailable >= qty` — so
        // two checkouts racing for the last unit can never both succeed (the
        // previous unconditional decrement drove stock negative = oversell).
        // RETURNING gives the exact post-decrement value for an accurate audit
        // row; the pre-transaction plan's before/after could be stale.
        const deductions = planned
          .flatMap((p) =>
            p.deductions.map((d) => ({
              ...d,
              variantId: p.variantId,
              name: p.name,
            })),
          )
          .sort((a, b) =>
            a.inventoryId < b.inventoryId
              ? -1
              : a.inventoryId > b.inventoryId
                ? 1
                : 0,
          );

        for (const d of deductions) {
          const rows = await tx.$queryRaw<{ quantityAvailable: number }[]>`
          UPDATE "Inventory"
             SET "quantityAvailable" = "quantityAvailable" - ${d.quantity},
                 "quantityReserved"  = "quantityReserved"  + ${d.quantity}
           WHERE "id" = ${d.inventoryId} AND "quantityAvailable" >= ${d.quantity}
           RETURNING "quantityAvailable"`;
          if (rows.length !== 1) {
            throw new ConflictException(
              `"${d.name}" just went out of stock. Please review your cart and try again.`,
            );
          }
          const after = Number(rows[0].quantityAvailable);
          const before = after + d.quantity;
          await tx.inventoryMovement.create({
            data: {
              inventoryId: d.inventoryId,
              variantId: d.variantId,
              warehouseId: d.warehouseId,
              movementType: 'sale',
              quantityChange: -d.quantity,
              quantityBefore: before,
              quantityAfter: after,
              referenceType: 'order',
              referenceId: orderId,
              createdById: userId,
              notes: `Reserved for ${parentOrderNumber}`,
            },
          });
        }

        // (f) Clear cart contents (keep the Cart row so future adds reuse it).
        // For PREPAID orders the cart is cleared only once payment is captured
        // (PaymentService), NOT here — so if the customer cancels/fails payment
        // their cart stays intact for an easy retry. COD/immediate orders clear now.
        if (paymentStatus !== PaymentStatus.AWAITING_PAYMENT) {
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        }
      });
    } catch (err) {
      // A duplicate submit that lost the race raises P2002 on the idempotency
      // index (only) — resolve it to the winning order rather than erroring.
      // Any other unique violation (orderNumber, etc.) must propagate.
      if (input.clientRequestId && isIdempotencyConflict(err)) {
        const existing = await this.prisma.order.findUnique({
          where: {
            customerId_idempotencyKey: {
              customerId,
              idempotencyKey: input.clientRequestId,
            },
          },
          include: ORDER_INCLUDE,
        });
        if (existing) return hydrateOrder(existing);
      }
      throw err;
    }

    // ---- Step 6: Return the freshly hydrated parent Order ------------------
    const fresh = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });

    // Fire-and-forget post-placement emails (customer confirmation +
    // per-seller new-order alerts). Wrapped in try/catch — any failure here
    // must NOT roll back the order or surface to the caller.
    this.dispatchPlacementEmails(orderId).catch((err) => {
      this.logger.warn(
        `Post-placement email dispatch failed for ${orderId}: ${(err as Error).message}`,
      );
    });

    return hydrateOrder(fresh);
  }

  // ---------------------------------------------------------------------------
  // Post-placement email dispatch
  // ---------------------------------------------------------------------------

  /**
   * Sends `order_placed` to the customer + `seller_new_order` to each seller.
   * Runs AFTER the placement transaction commits so emails reflect the
   * canonical DB state. Soft-fails per-recipient — one bad address doesn't
   * block the others.
   */
  private async dispatchPlacementEmails(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { include: { user: true } },
        sellerOrders: {
          include: {
            store: { include: { seller: { include: { user: true } } } },
            items: true,
          },
        },
      },
    });
    if (!order) return;

    const shopName = 'Trueway';
    const frontendUrl = config.FRONTEND_URL ?? '';
    const totalAmount = formatRupees(Number(order.totalAmount));

    // ---- Customer confirmation ----
    const customerEmail = order.customer?.user?.email;
    const customerName = order.customer?.user?.name ?? 'there';
    if (customerEmail) {
      await this.email.send('order_placed', customerEmail, {
        customerName,
        orderNumber: order.orderNumber,
        totalAmount,
        orderLink: `${frontendUrl}/account/orders/${order.id}`,
        shopName,
      });
    }

    // ---- Per-seller new-order alerts ----
    for (const so of order.sellerOrders) {
      const sellerUser = so.store?.seller?.user;
      if (!sellerUser?.email) continue;
      const itemCount = so.items.reduce((s, i) => s + i.quantity, 0);
      await this.email.send('seller_new_order', sellerUser.email, {
        sellerName: so.store?.seller?.displayName ?? sellerUser.name,
        orderNumber: so.orderNumber,
        itemCount: String(itemCount),
        subtotal: formatRupees(Number(so.subtotal)),
        orderLink: `${frontendUrl}/seller/orders/${so.id}`,
        shopName,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Inventory deduction planning
  // ---------------------------------------------------------------------------

  /**
   * Plan how to source `quantity` units of a variant from one or more
   * warehouses. We greedily fill from the warehouse with the most
   * available stock first — minimizes the chance of leaving small,
   * un-shippable remnants in many places.
   *
   * Throws BadRequestException if total available stock across warehouses
   * is less than `quantity`.
   */
  private async planInventoryDeductions(
    variantId: string,
    quantity: number,
  ): Promise<InventoryDeduction[]> {
    const rows = await this.prisma.inventory.findMany({
      where: { variantId, deletedAt: null, quantityAvailable: { gt: 0 } },
      orderBy: { quantityAvailable: 'desc' },
    });
    const totalAvailable = rows.reduce((s, r) => s + r.quantityAvailable, 0);
    if (totalAvailable < quantity) {
      throw new BadRequestException(
        `Not enough stock for one of the items (need ${quantity}, have ${totalAvailable}).`,
      );
    }
    let remaining = quantity;
    const out: InventoryDeduction[] = [];
    for (const row of rows) {
      if (remaining <= 0) break;
      const take = Math.min(row.quantityAvailable, remaining);
      out.push({
        inventoryId: row.id,
        warehouseId: row.warehouseId,
        quantity: take,
        before: row.quantityAvailable,
        after: row.quantityAvailable - take,
      });
      remaining -= take;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** UUID v4 — the same generator Prisma uses for `@default(uuid())`. */
function randomUUID(): string {
  // Prisma's `cuid` and Node's crypto.randomUUID both work; we use the
  // latter so the order id is stable across Prisma upgrades.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').randomUUID();
}

/** Round to 2 decimal places (paise). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
