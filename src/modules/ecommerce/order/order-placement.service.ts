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

    const sellerOrderRows: {
      id: string;
      sellerId: string;
      storeId: string;
      orderNumber: string;
      subtotal: number;
      taxAmount: number;
      commissionAmount: number;
      payoutAmount: number;
      items: PlannedItem[];
    }[] = [];

    let parentSubtotal = 0;
    let parentTax = 0;

    for (const [, items] of groups) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: items[0].sellerId },
        select: { commissionRate: true },
      });
      const commissionRate = Number(seller?.commissionRate ?? 0);

      let soSubtotal = 0;
      let soTax = 0;
      for (const it of items) {
        const lineSubtotal = it.unitPrice * it.quantity;
        const lineTax = (lineSubtotal * it.taxRate) / 100;
        soSubtotal += lineSubtotal;
        soTax += lineTax;
      }
      const commissionAmount = (soSubtotal * commissionRate) / 100;
      const payoutAmount = soSubtotal + soTax - commissionAmount;

      parentSubtotal += soSubtotal;
      parentTax += soTax;

      sellerOrderRows.push({
        id: randomUUID(),
        sellerId: items[0].sellerId,
        storeId: items[0].storeId,
        orderNumber: `SORD-${orderNumberSuffix}`,
        subtotal: round2(soSubtotal),
        taxAmount: round2(soTax),
        commissionAmount: round2(commissionAmount),
        payoutAmount: round2(payoutAmount),
        items,
      });
    }

    // SellerOrder.orderNumber is unique — disambiguate if 2+ sub-orders.
    if (sellerOrderRows.length > 1) {
      sellerOrderRows.forEach((row, idx) => {
        row.orderNumber = `SORD-${orderNumberSuffix}-${idx + 1}`;
      });
    }

    const totalAmount = parentSubtotal + parentTax;

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
          discountAmount: 0,
          totalAmount: round2(totalAmount),
          currencyCode: 'INR',
          shippingAddressId: shippingAddress.id,
          billingAddressId: billingAddress.id,
          customerNotes: input.customerNotes ?? null,
        },
      });

      // (b) SellerOrders + (c) OrderItems + (d) status history
      for (const so of sellerOrderRows) {
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
            commissionAmount: so.commissionAmount,
            payoutAmount: so.payoutAmount,
            currencyCode: 'INR',
          },
        });

        for (const it of so.items) {
          const lineSubtotal = it.unitPrice * it.quantity;
          const lineTax = (lineSubtotal * it.taxRate) / 100;
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
              totalPrice: round2(lineSubtotal),
              taxAmount: round2(lineTax),
              discountAmount: 0,
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
