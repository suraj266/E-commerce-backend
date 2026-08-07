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

  /** Published reviews for a product page, paginated + rating-filtered/sorted. Public. */
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

  /** Aggregate rating average + per-star counts for a product's PDP header. Public. */
  @Query(() => ProductRatingSummary, { name: 'productRatingSummary' })
  summary(@Args('productId', { type: () => ID }) productId: string) {
    return this.service.summary(productId);
  }

  // ---------------------------------------------------------------------------
  // Customer-authenticated
  // ---------------------------------------------------------------------------

  /** The caller's own reviews, newest first, for the account "My reviews" page. Auth: logged-in customer. */
  @UseGuards(JwtAuthGuard)
  @Query(() => [Review], { name: 'myReviews' })
  myReviews(@CurrentUser() user: CurrentUserPayload) {
    return this.service.myReviews(user.userId);
  }

  /** The caller's own review for a product, if any. Auth: logged-in customer. */
  @UseGuards(JwtAuthGuard)
  @Query(() => Review, { name: 'myReview', nullable: true })
  myReview(
    @Args('productId', { type: () => ID }) productId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.myReview(user.userId, productId);
  }

  /** Whether the caller may review a product (needs a delivered order + no existing review). Auth: logged-in customer. */
  @UseGuards(JwtAuthGuard)
  @Query(() => ReviewEligibility, { name: 'reviewEligibility' })
  eligibility(
    @Args('productId', { type: () => ID }) productId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.eligibility(user.userId, productId);
  }

  /** Customer writes a review (delivered-order gated); starts PENDING until admin moderation. Auth: logged-in customer. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Review)
  createReview(
    @Args('input') input: CreateReviewInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.create(user.userId, input);
  }

  /** Customer edits their own review; a published one re-enters PENDING moderation. Auth: logged-in customer. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Review)
  updateReview(
    @Args('input') input: UpdateReviewInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.service.update(user.userId, input);
  }

  /** Customer soft-deletes their own review (kept for reproducible rating history). Auth: logged-in customer. */
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
