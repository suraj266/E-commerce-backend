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
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, OrderStatus, PaymentStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { CouponService } from '@/modules/ecommerce/coupon/coupon.service';
import { config } from '@/common/config/config';
import { PlaceOrderInput } from './dto/place-order.input';
import { generateOrderNumber } from './order.helpers';
import { ORDER_INCLUDE, hydrateOrder } from './order.hydrate';

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
  unitPrice: number;
  taxRate: number; // percentage 0-100
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
      throw new ForbiddenException('Checkout is only available to customer accounts.');
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
  ) {
    const customerId = await this.getCustomerId(userId);

    // ---- Step 1: Load cart with items + product/variant + tax ---------------
    const cart = await this.prisma.cart.findUnique({
      where: { customerId },
      include: {
        items: {
          include: {
            variant: { include: {
              attributes: { include: { attribute: true, attributeValue: true } },
            } },
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
    if (input.billingAddressId && input.billingAddressId !== input.shippingAddressId) {
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
        throw new BadRequestException(`Variant ${it.variantId} is no longer available.`);
      }
      if (!it.product || it.product.deletedAt || it.product.status !== 'ACTIVE') {
        throw new BadRequestException(`"${it.product?.name ?? 'A product'}" is no longer available.`);
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
        attributesSnapshot,
        imageUrlSnapshot,
        deductions,
      });
    }

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

    // ---- Step 4a: Per-line subtotals (pre-discount) ------------------------
    // Build the seller-order shells now so we can run coupon validation
    // against accurate per-store subtotals. Tax + commission + payout are
    // computed LATER, after any per-line discount allocation, so GST lands
    // on the discounted taxable value (CGST Act §15(3)(a)).
    interface LineMath {
      lineSubtotal: number;
      lineDiscount: number;   // share of the coupon's per-store discount
      lineTax: number;        // GST on (subtotal - discount)
    }
    const lineMaths: LineMath[][] = []; // parallel to sellerOrderRows order

    const sellerOrderRows: {
      id: string;
      sellerId: string;
      storeId: string;
      orderNumber: string;
      subtotal: number;       // pre-discount, shown on invoice as gross
      taxAmount: number;      // GST on (subtotal - discount), GST-correct
      discountAmount: number; // sum of per-line discounts
      commissionAmount: number;
      payoutAmount: number;
      commissionRate: number; // captured for the post-discount recompute
      items: PlannedItem[];
    }[] = [];

    for (const [, items] of groups) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: items[0].sellerId },
        select: { commissionRate: true },
      });
      const commissionRate = Number(seller?.commissionRate ?? 0);

      const itemMaths: LineMath[] = items.map((it) => ({
        lineSubtotal: it.unitPrice * it.quantity,
        lineDiscount: 0,
        lineTax: 0,
      }));
      const soSubtotal = itemMaths.reduce((s, m) => s + m.lineSubtotal, 0);

      sellerOrderRows.push({
        id: randomUUID(),
        sellerId: items[0].sellerId,
        storeId: items[0].storeId,
        orderNumber: `SORD-${orderNumberSuffix}`,
        subtotal: round2(soSubtotal),
        taxAmount: 0,        // filled in step 4c
        discountAmount: 0,   // filled in step 4c
        commissionAmount: 0, // filled in step 4c
        payoutAmount: 0,     // filled in step 4c
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
    // lines proportionally to lineSubtotal. The last line eats any rounding
    // drift so the sum ties exactly to the store's allotment.
    let parentSubtotal = 0;
    let parentTax = 0;
    let parentDiscount = 0;

    for (let i = 0; i < sellerOrderRows.length; i++) {
      const so = sellerOrderRows[i];
      const items = so.items;
      const maths = lineMaths[i];
      const storeDiscount = perStoreDiscount.get(so.storeId) ?? 0;

      let allocated = 0;
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
        const taxableValue = Math.max(0, m.lineSubtotal - lineDiscount);
        const lineTax = round2((taxableValue * it.taxRate) / 100);

        m.lineDiscount = lineDiscount;
        m.lineTax = lineTax;
      }

      const soTax = maths.reduce((s, m) => s + m.lineTax, 0);
      const soTaxableValue = so.subtotal - storeDiscount;
      // Commission on the taxable (post-discount) value — matches the
      // seller's actual GST-recognised revenue and is the typical contract
      // term for Indian marketplaces.
      const commissionAmount = round2((soTaxableValue * so.commissionRate) / 100);
      // Payout = taxable value + GST collected on that value − commission.
      // The customer pays exactly this to the platform; platform pays the
      // commission to itself and forwards the rest to the seller.
      const payoutAmount = round2(soTaxableValue + soTax - commissionAmount);

      so.taxAmount = round2(soTax);
      so.discountAmount = round2(storeDiscount);
      so.commissionAmount = commissionAmount;
      so.payoutAmount = payoutAmount;

      parentSubtotal += so.subtotal;
      parentTax += so.taxAmount;
      parentDiscount += so.discountAmount;
    }

    const totalAmount = round2(parentSubtotal + parentTax - parentDiscount);
    couponDiscount = round2(parentDiscount); // tie out exactly to per-store sum

    // ---- Step 5: One transaction commits everything ------------------------
    await this.prisma.$transaction(async (tx) => {
      // (a) parent Order
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
          shippingAmount: 0,
          discountAmount: round2(couponDiscount),
          totalAmount: round2(totalAmount),
          currencyCode: 'INR',
          couponId: appliedCouponId,
          couponCode: appliedCouponCode,
          shippingAddressId: shippingAddress.id,
          billingAddressId: billingAddress.id,
          customerNotes: input.customerNotes ?? null,
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
            discountAmount: so.discountAmount,
            commissionAmount: so.commissionAmount,
            payoutAmount: so.payoutAmount,
            currencyCode: 'INR',
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
              // totalPrice = gross line value (pre-discount). Matches Order.subtotal contribution.
              totalPrice: round2(m.lineSubtotal),
              // GST on the discounted taxable value, per CGST Act §15(3)(a).
              taxAmount: m.lineTax,
              // Coupon's allocated share for this line (0 when no coupon).
              discountAmount: m.lineDiscount,
              attributesSnapshot: it.attributesSnapshot as unknown as Prisma.InputJsonValue,
              imageUrlSnapshot: it.imageUrlSnapshot,
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

      // (e) Inventory deductions: qtyAvailable → qtyReserved + movements
      for (const p of planned) {
        for (const d of p.deductions) {
          await tx.inventory.update({
            where: { id: d.inventoryId },
            data: {
              quantityAvailable: { decrement: d.quantity },
              quantityReserved: { increment: d.quantity },
            },
          });
          await tx.inventoryMovement.create({
            data: {
              inventoryId: d.inventoryId,
              variantId: p.variantId,
              warehouseId: d.warehouseId,
              movementType: 'sale',
              quantityChange: -d.quantity,
              quantityBefore: d.before,
              quantityAfter: d.after,
              referenceType: 'order',
              referenceId: orderId,
              createdById: userId,
              notes: `Reserved for ${parentOrderNumber}`,
            },
          });
        }
      }

      // (f) clear cart contents (keep Cart row so future adds reuse it)
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    });

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
    const totalAvailable = rows.reduce(
      (s, r) => s + r.quantityAvailable,
      0,
    );
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
