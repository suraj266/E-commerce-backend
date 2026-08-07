import { Resolver, Query, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { DashboardService } from './dashboard.service';
import { AdminDashboardStats } from './entities/admin-dashboard-stats.entity';
import { AdminAnalytics } from './entities/admin-analytics.entity';
import { AnalyticsRangeInput } from './dto/analytics-range.input';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => AdminDashboardStats)
export class DashboardResolver {
  constructor(private readonly service: DashboardService) {}

  /** Admin dashboard KPIs — revenue/orders/products/users MoM, monthly chart, recent orders. Auth: dashboard:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('dashboard:read')
  @Query(() => AdminDashboardStats, { name: 'adminDashboardStats' })
  getStats() {
    return this.service.getStats();
  }

  /**
   * Date-range scoped platform analytics — net-of-refunds revenue, GMV series
   * (day/week/month), order counts by status, new signups, and top
   * products/sellers. READ-ONLY. Auth: dashboard:read.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('dashboard:read')
  @Query(() => AdminAnalytics, { name: 'adminAnalytics' })
  getAnalytics(
    @Args('input', { type: () => AnalyticsRangeInput, nullable: true })
    input?: AnalyticsRangeInput,
  ) {
    return this.service.getAnalytics(input);
  }
}
