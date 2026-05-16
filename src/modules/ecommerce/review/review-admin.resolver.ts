import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

import { ReviewService } from './review.service';
import {
  AdminReview,
  PaginatedAdminReviews,
  ReviewStatus,
} from './entities/review.entity';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';

@Resolver(() => AdminReview)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReviewAdminResolver {
  constructor(private readonly service: ReviewService) {}

  @Permissions('review:read')
  @Query(() => PaginatedAdminReviews, { name: 'adminReviews' })
  list(
    @Args('status', { type: () => ReviewStatus, nullable: true })
    status?: ReviewStatus | null,
    @Args('search', { type: () => String, nullable: true })
    search?: string | null,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
  ) {
    return this.service.adminList({ status, search, page, pageSize });
  }

  @Permissions('review:moderate')
  @Mutation(() => AdminReview)
  approveReview(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.approve(user.userId, id);
  }

  @Permissions('review:moderate')
  @Mutation(() => AdminReview)
  rejectReview(
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { type: () => String, nullable: true }) reason: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.reject(user.userId, id, reason);
  }
}
