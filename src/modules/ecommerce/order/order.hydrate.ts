/**
 * Hydration helpers — convert Prisma rows into the GraphQL Order shape.
 *
 * Prisma returns Decimal values as Decimal instances; GraphQL Float
 * fields need plain numbers. We do the conversion here in one place so
 * resolvers/services don't sprinkle `Number(x.foo)` calls everywhere.
 */

import type {
  Order as PrismaOrder,
  OrderItem as PrismaOrderItem,
  SellerOrder as PrismaSellerOrder,
  OrderStatusHistory as PrismaStatusHistoryRow,
  UserAddress as PrismaUserAddress,
} from '@prisma/client';
import {
  computeParentStatus,
} from './order.helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function hydrateAddress(addr: PrismaUserAddress | null | undefined) {
  if (!addr) return null;
  return {
    id: addr.id,
    firstName: addr.firstName,
    lastName: addr.lastName,
    phone: addr.phone,
    addressLine1: addr.addressLine1,
    addressLine2: addr.addressLine2,
    city: addr.city,
    state: addr.state,
    postalCode: addr.postalCode,
    countryCode: addr.countryCode,
  };
}

export function hydrateOrderItem(it: PrismaOrderItem) {
  return {
    ...it,
    unitPrice: Number(it.unitPrice),
    totalPrice: Number(it.totalPrice),
    taxAmount: Number(it.taxAmount),
    discountAmount: Number(it.discountAmount),
    // Phase 1 compliance + tax-split fields. All four-decimal Decimal columns
    // collapse to plain number for GraphQL — JSON can't carry arbitrary
    // precision and 4 dp survives the round-trip.
    taxableValue: Number((it as Any).taxableValue ?? 0),
    cgstRate: Number((it as Any).cgstRate ?? 0),
    cgstAmount: Number((it as Any).cgstAmount ?? 0),
    sgstRate: Number((it as Any).sgstRate ?? 0),
    sgstAmount: Number((it as Any).sgstAmount ?? 0),
    igstRate: Number((it as Any).igstRate ?? 0),
    igstAmount: Number((it as Any).igstAmount ?? 0),
    cessRate: Number((it as Any).cessRate ?? 0),
    cessAmount: Number((it as Any).cessAmount ?? 0),
    attributesSnapshot: Array.isArray(it.attributesSnapshot)
      ? (it.attributesSnapshot as Any[]).map((a) => ({
          attributeName: String(a?.attributeName ?? ''),
          value: String(a?.value ?? ''),
        }))
      : [],
  };
}

export function hydrateStatusHistory(rows: PrismaStatusHistoryRow[]) {
  return rows.map((r) => ({
    id: r.id,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    changedById: r.changedById,
    notes: r.notes,
    createdAt: r.createdAt,
  }));
}

/**
 * Hydrate a SellerOrder. Expects Prisma includes for items + statusHistory
 * + store + (optionally) order with shipping address + customer user.
 */
export function hydrateSellerOrder(so: Any) {
  const items = (so.items ?? []).map(hydrateOrderItem);
  return {
    ...so,
    subtotal: Number(so.subtotal),
    taxAmount: Number(so.taxAmount),
    shippingAmount: Number(so.shippingAmount),
    discountAmount: Number(so.discountAmount),
    commissionAmount: Number(so.commissionAmount),
    payoutAmount: Number(so.payoutAmount),
    quotedShippingRate: so.quotedShippingRate != null ? Number(so.quotedShippingRate) : null,
    billableWeightKg: so.billableWeightKg != null ? Number(so.billableWeightKg) : null,
    items,
    itemCount: items.reduce((s: number, i: Any) => s + (i.quantity ?? 0), 0),
    storeName: so.store?.name ?? null,
    statusHistory: so.statusHistory
      ? hydrateStatusHistory(so.statusHistory)
      : [],
    parentOrderNumber: so.order?.orderNumber ?? null,
    shippingAddress: hydrateAddress(so.order?.shippingAddress ?? null),
    customerName: so.order?.customer?.user?.name ?? null,
  };
}

/**
 * Hydrate a parent Order. Expects Prisma includes for items + sellerOrders
 * (with their items + status history) + addresses + status history.
 */
export function hydrateOrder(order: Any) {
  const items = (order.items ?? []).map(hydrateOrderItem);
  const sellerOrders = (order.sellerOrders ?? []).map(hydrateSellerOrder);
  const subStatuses = sellerOrders.map((s: Any) => s.status);
  return {
    ...order,
    subtotal: Number(order.subtotal),
    taxAmount: Number(order.taxAmount),
    shippingAmount: Number(order.shippingAmount),
    discountAmount: Number(order.discountAmount),
    totalAmount: Number(order.totalAmount),
    // Parent order's status is rolled up from sub-orders so the customer's
    // dashboard reflects "where my whole order is at".
    status:
      subStatuses.length > 0 ? computeParentStatus(subStatuses) : order.status,
    items,
    sellerOrders,
    itemCount: items.reduce((s: number, i: Any) => s + (i.quantity ?? 0), 0),
    statusHistory: order.statusHistory
      ? hydrateStatusHistory(order.statusHistory)
      : [],
    shippingAddress: hydrateAddress(order.shippingAddress ?? null),
    billingAddress: hydrateAddress(order.billingAddress ?? null),
  };
}

/**
 * Standard Prisma include shape for a fully-hydrated Order. Used by every
 * service method that returns the GraphQL Order type so the shape stays
 * consistent.
 */
export const ORDER_INCLUDE = {
  shippingAddress: true,
  billingAddress: true,
  items: true,
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  sellerOrders: {
    include: {
      items: true,
      store: true,
      statusHistory: { orderBy: { createdAt: 'asc' as const } },
    },
  },
} as const;

/** Include shape for SellerOrder list/detail used by sellers. */
export const SELLER_ORDER_INCLUDE = {
  items: true,
  store: true,
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  order: {
    include: {
      shippingAddress: true,
      customer: { include: { user: { select: { name: true } } } },
    },
  },
} as const;

/** Type-only re-exports so consumers don't need to know Prisma names. */
export type { PrismaOrder, PrismaSellerOrder };
