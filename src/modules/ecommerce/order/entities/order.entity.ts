import { ObjectType, Field, ID, Int, Float, registerEnumType } from '@nestjs/graphql';
import {
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  PayoutStatus,
} from '@prisma/client';

registerEnumType(OrderStatus, { name: 'OrderStatus' });
registerEnumType(PaymentStatus, { name: 'PaymentStatus' });
registerEnumType(PaymentMethod, { name: 'PaymentMethod' });
registerEnumType(PayoutStatus, { name: 'PayoutStatus' });

/**
 * Variant axis snapshot — captured on the OrderItem so we can render
 * "Color: Red, Size: M" on the order detail even after the variant is
 * deleted or its attributes change.
 */
@ObjectType()
export class OrderItemAttribute {
  @Field(() => String)
  attributeName: string;

  @Field(() => String)
  value: string;
}

@ObjectType()
export class OrderItem {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  orderId: string;

  @Field(() => ID)
  sellerOrderId: string;

  @Field(() => ID)
  productId: string;

  @Field(() => ID)
  variantId: string;

  @Field(() => ID)
  storeId: string;

  @Field(() => String)
  sku: string;

  @Field(() => String)
  name: string;

  @Field(() => String, { nullable: true })
  variantName?: string | null;

  @Field(() => Int)
  quantity: number;

  @Field(() => Float)
  unitPrice: number;

  @Field(() => Float)
  totalPrice: number;

  @Field(() => Float)
  taxAmount: number;

  @Field(() => Float)
  discountAmount: number;

  @Field(() => [OrderItemAttribute])
  attributesSnapshot: OrderItemAttribute[];

  @Field(() => String, { nullable: true })
  imageUrlSnapshot?: string | null;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class OrderStatusHistoryEntry {
  @Field(() => ID)
  id: string;

  @Field(() => OrderStatus, { nullable: true })
  fromStatus?: OrderStatus | null;

  @Field(() => OrderStatus)
  toStatus: OrderStatus;

  @Field(() => ID, { nullable: true })
  changedById?: string | null;

  @Field(() => String, { nullable: true })
  notes?: string | null;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class OrderAddressSnapshot {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  firstName: string;

  @Field(() => String)
  lastName: string;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String)
  addressLine1: string;

  @Field(() => String, { nullable: true })
  addressLine2?: string | null;

  @Field(() => String)
  city: string;

  @Field(() => String)
  state: string;

  @Field(() => String)
  postalCode: string;

  @Field(() => String)
  countryCode: string;
}

/**
 * Per-seller sub-order. Each seller fulfills their slice independently —
 * they only ever see the SellerOrder for items they own, never the parent
 * Order's full payload.
 */
@ObjectType()
export class SellerOrder {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  orderId: string;

  @Field(() => ID)
  sellerId: string;

  @Field(() => ID)
  storeId: string;

  @Field(() => String)
  orderNumber: string;

  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field(() => PaymentStatus)
  paymentStatus: PaymentStatus;

  @Field(() => PayoutStatus)
  payoutStatus: PayoutStatus;

  @Field(() => Float)
  subtotal: number;

  @Field(() => Float)
  taxAmount: number;

  @Field(() => Float)
  shippingAmount: number;

  @Field(() => Float)
  discountAmount: number;

  @Field(() => Float)
  commissionAmount: number;

  @Field(() => Float)
  payoutAmount: number;

  @Field(() => String)
  currencyCode: string;

  @Field(() => Date, { nullable: true })
  packedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  shippedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  deliveredAt?: Date | null;

  @Field(() => Date, { nullable: true })
  cancelledAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => [OrderItem])
  items: OrderItem[];

  @Field(() => Int)
  itemCount: number;

  @Field(() => String, { nullable: true })
  storeName?: string | null;

  @Field(() => [OrderStatusHistoryEntry])
  statusHistory: OrderStatusHistoryEntry[];

  /** Flattened parent-order context — convenience for seller dashboards. */
  @Field(() => String, { nullable: true })
  parentOrderNumber?: string | null;

  @Field(() => OrderAddressSnapshot, { nullable: true })
  shippingAddress?: OrderAddressSnapshot | null;

  @Field(() => String, { nullable: true })
  customerName?: string | null;
}

/**
 * Customer-facing parent order — bundles everything the customer sees.
 * Sellers never receive this shape; they get filtered SellerOrder rows.
 */
@ObjectType()
export class Order {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  orderNumber: string;

  @Field(() => ID)
  customerId: string;

  @Field(() => OrderStatus, {
    description:
      'Aggregate status across all SellerOrders. Computed as the earliest stage any sub-order is at.',
  })
  status: OrderStatus;

  @Field(() => PaymentStatus)
  paymentStatus: PaymentStatus;

  @Field(() => PaymentMethod)
  paymentMethod: PaymentMethod;

  @Field(() => Float)
  subtotal: number;

  @Field(() => Float)
  taxAmount: number;

  @Field(() => Float)
  shippingAmount: number;

  @Field(() => Float)
  discountAmount: number;

  @Field(() => Float)
  totalAmount: number;

  @Field(() => String)
  currencyCode: string;

  @Field(() => OrderAddressSnapshot, { nullable: true })
  shippingAddress?: OrderAddressSnapshot | null;

  @Field(() => OrderAddressSnapshot, { nullable: true })
  billingAddress?: OrderAddressSnapshot | null;

  @Field(() => String, { nullable: true })
  customerNotes?: string | null;

  @Field(() => Date)
  placedAt: Date;

  @Field(() => Date, { nullable: true })
  cancelledAt?: Date | null;

  @Field(() => Date, { nullable: true })
  deliveredAt?: Date | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => [SellerOrder])
  sellerOrders: SellerOrder[];

  @Field(() => [OrderItem])
  items: OrderItem[];

  @Field(() => Int)
  itemCount: number;

  @Field(() => [OrderStatusHistoryEntry])
  statusHistory: OrderStatusHistoryEntry[];
}

@ObjectType()
export class PaginatedOrders {
  @Field(() => [Order])
  items: Order[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}

@ObjectType()
export class PaginatedSellerOrders {
  @Field(() => [SellerOrder])
  items: SellerOrder[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
