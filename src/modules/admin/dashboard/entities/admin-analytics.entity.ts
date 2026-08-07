import { ObjectType, Field, Float, Int, ID } from '@nestjs/graphql';
import { OrderStatus } from '@prisma/client';
import { AnalyticsBucket } from '../dto/analytics-range.input';

/**
 * Object types backing the `adminAnalytics` query — platform-wide, date-range
 * scoped aggregations for the admin dashboard. All money fields are plain
 * rupee numbers (the service converts Prisma Decimals before returning).
 *
 * `OrderStatus` is registered as a GraphQL enum in the order module's entity
 * file (order.entity.ts) — do NOT re-register it here.
 */

@ObjectType()
export class AnalyticsRange {
  @Field(() => Date)
  from: Date;

  @Field(() => Date)
  to: Date;

  @Field(() => AnalyticsBucket)
  granularity: AnalyticsBucket;
}

@ObjectType()
export class RevenueSummary {
  /** Gross GMV over revenue-bearing orders (CONFIRMED..DELIVERED) in range. */
  @Field(() => Float)
  gross: number;

  /** Total PROCESSED refund amount in range. */
  @Field(() => Float)
  refunds: number;

  /** Platform revenue net of refunds: `gross − refunds`. */
  @Field(() => Float)
  net: number;

  /** Count of revenue-bearing orders in range. */
  @Field(() => Int)
  orderCount: number;

  @Field(() => Float)
  avgOrderValue: number;
}

@ObjectType()
export class AnalyticsSeriesPoint {
  /** ISO timestamp of the bucket start (UTC). */
  @Field(() => String)
  bucket: string;

  /** Human-friendly bucket label ("05 Jul" for day/week, "Jul 2026" for month). */
  @Field(() => String)
  label: string;

  /** Gross merchandise value placed within the bucket. */
  @Field(() => Float)
  gmv: number;

  @Field(() => Int)
  orderCount: number;
}

@ObjectType()
export class OrderStatusCount {
  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field(() => Int)
  count: number;
}

@ObjectType()
export class NewSignups {
  @Field(() => Int)
  users: number;

  @Field(() => Int)
  sellers: number;
}

@ObjectType()
export class TopProduct {
  @Field(() => ID)
  productId: string;

  @Field(() => String)
  name: string;

  @Field(() => Int)
  unitsSold: number;

  /** Gross line revenue (sum of OrderItem.totalPrice) over the window. */
  @Field(() => Float)
  grossRevenue: number;
}

@ObjectType()
export class TopSeller {
  @Field(() => ID)
  sellerId: string;

  @Field(() => String)
  sellerName: string;

  @Field(() => Int)
  orderCount: number;

  /** Gross sales (sum of SellerOrder.subtotal) attributed to the seller. */
  @Field(() => Float)
  gmv: number;

  /** Net payable to the seller after commission (sum of payoutAmount). */
  @Field(() => Float)
  netPayable: number;
}

@ObjectType()
export class AdminAnalytics {
  @Field(() => AnalyticsRange)
  range: AnalyticsRange;

  @Field(() => RevenueSummary)
  revenue: RevenueSummary;

  @Field(() => NewSignups)
  newSignups: NewSignups;

  /** Time-bucketed GMV series (day/week/month) over the range. */
  @Field(() => [AnalyticsSeriesPoint])
  gmvSeries: AnalyticsSeriesPoint[];

  /** Order counts by status placed within the range (all statuses, zero-filled). */
  @Field(() => [OrderStatusCount])
  ordersByStatus: OrderStatusCount[];

  @Field(() => [TopProduct])
  topProducts: TopProduct[];

  @Field(() => [TopSeller])
  topSellers: TopSeller[];
}
