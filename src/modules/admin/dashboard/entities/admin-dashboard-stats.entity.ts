import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';
import { OrderStatus } from '@prisma/client';

@ObjectType()
export class StatDelta {
  @Field(() => Float)
  current: number;

  @Field(() => Float)
  previous: number;

  @Field(() => Float)
  changePct: number;
}

@ObjectType()
export class MonthlyRevenuePoint {
  @Field(() => String)
  month: string;

  @Field(() => Float)
  value: number;
}

@ObjectType()
export class RecentOrderItem {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  orderNumber: string;

  @Field(() => String)
  customerName: string;

  @Field(() => String)
  productSummary: string;

  @Field(() => Float)
  totalAmount: number;

  @Field(() => OrderStatus)
  status: OrderStatus;

  @Field(() => Date)
  placedAt: Date;
}

@ObjectType()
export class AdminDashboardStats {
  @Field(() => StatDelta)
  totalRevenue: StatDelta;

  @Field(() => StatDelta)
  totalOrders: StatDelta;

  @Field(() => StatDelta)
  totalProducts: StatDelta;

  @Field(() => StatDelta)
  activeUsers: StatDelta;

  @Field(() => [MonthlyRevenuePoint])
  monthlyRevenue: MonthlyRevenuePoint[];

  @Field(() => Float)
  conversionRate: number;

  @Field(() => Float)
  avgOrderValue: number;

  @Field(() => Int)
  activeSellers: number;

  @Field(() => Int)
  pendingReturns: number;

  @Field(() => [RecentOrderItem])
  recentOrders: RecentOrderItem[];
}
