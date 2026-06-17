import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

/**
 * Seller-scoped earnings + sales analytics, returned by the `mySellerStats`
 * query. All money fields are plain numbers (rupees); the resolver converts
 * Prisma Decimals before returning. Aggregated over the seller's own
 * SellerOrders only.
 */

@ObjectType()
export class SellerStatPoint {
  /** Bucket label, e.g. a month abbreviation ("Jan"). */
  @Field(() => String)
  label: string;

  @Field(() => Float)
  value: number;
}

@ObjectType()
export class SellerBestSeller {
  @Field(() => String)
  productId: string;

  @Field(() => String)
  name: string;

  @Field(() => Int)
  unitsSold: number;

  /** Gross line revenue (sum of item totalPrice) over the window. */
  @Field(() => Float)
  revenue: number;
}

@ObjectType()
export class SellerStats {
  // --- Net earnings (payout amount, after commission) ---
  @Field(() => Float)
  netEarningsThisMonth: number;

  @Field(() => Float)
  netEarningsLastMonth: number;

  /** % change of this month's net earnings vs last month. */
  @Field(() => Float)
  netEarningsChangePct: number;

  @Field(() => Float)
  lifetimeNetEarnings: number;

  // --- Gross / commission ---
  @Field(() => Float)
  grossSalesThisMonth: number;

  @Field(() => Float)
  lifetimeCommission: number;

  // --- Payout status (over revenue-bearing orders) ---
  @Field(() => Float)
  pendingPayoutAmount: number;

  @Field(() => Float)
  paidPayoutAmount: number;

  // --- Order counts ---
  @Field(() => Int)
  ordersThisMonth: number;

  @Field(() => Int)
  ordersLastMonth: number;

  @Field(() => Float)
  ordersChangePct: number;

  @Field(() => Int)
  lifetimeOrders: number;

  @Field(() => Float)
  avgOrderValue: number;

  // --- Fulfilment pipeline (lifetime counts by status) ---
  @Field(() => Int)
  pendingOrders: number;

  /** CONFIRMED + PACKED — orders awaiting shipment. */
  @Field(() => Int)
  toShipOrders: number;

  @Field(() => Int)
  deliveredOrders: number;

  @Field(() => Int)
  cancelledOrders: number;

  // --- Series + leaderboards ---
  /** Net earnings bucketed by month for the current calendar year. */
  @Field(() => [SellerStatPoint])
  monthlyEarnings: SellerStatPoint[];

  /** Top products by units sold over the last 30 days. */
  @Field(() => [SellerBestSeller])
  bestSellers: SellerBestSeller[];
}
