import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

import { ReviewService } from './review.service';
import {
  PaginatedReviews,
  ProductRatingSummary,
  Review,
  ReviewEligibility,
} from './entities/review.entity';
import { CreateReviewInput } from './dto/create-review.input';
import { UpdateReviewInput } from './dto/update-review.input';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';

@Resolver(() => Review)
export class ReviewResolver {
  constructor(private readonly service: ReviewService) {}

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  @Query(() => PaginatedReviews, { name: 'publicProductReviews' })
  publicList(
    @Args('productId', { type: () => ID }) productId: string,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('rating', { type: () => Int, nullable: true }) rating?: number,
    @Args('sort', { type: () => String, nullable: true })
    sort?: 'newest' | 'highest' | 'lowest',
  ) {
    return this.service.publicList({ productId, page, pageSize, rating, sort });
  }

  @Query(() => ProductRatingSummary, { name: 'productRatingSummary' })
  summary(@Args('productId', { type: () => ID }) productId: string) {
    return this.service.summary(productId);
  }

  // ---------------------------------------------------------------------------
  // Customer-authenticated
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Query(() => Review, { name: 'myReview', nullable: true })
  myReview(
    @Args('productId', { type: () => ID }) productId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.myReview(user.userId, productId);
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => ReviewEligibility, { name: 'reviewEligibility' })
  eligibility(
    @Args('productId', { type: () => ID }) productId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.eligibility(user.userId, productId);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Review)
  createReview(
    @Args('input') input: CreateReviewInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.create(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Review)
  updateReview(
    @Args('input') input: UpdateReviewInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Review, { nullable: true })
  async deleteReview(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.service.delete(user.userId, id);
    return null;
  }
}
