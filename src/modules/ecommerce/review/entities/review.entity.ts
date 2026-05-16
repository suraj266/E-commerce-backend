import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

export enum ReviewStatus {
  PUBLISHED = 'PUBLISHED',
  HIDDEN = 'HIDDEN',
  PENDING = 'PENDING',
}
registerEnumType(ReviewStatus, { name: 'ReviewStatus' });

export enum ReviewMediaType {
  IMAGE = 'IMAGE',
  VIDEO = 'VIDEO',
}
registerEnumType(ReviewMediaType, { name: 'ReviewMediaType' });

/**
 * Media attachment on a review. URLs are absolute (the upload endpoint
 * returns absolute URLs already). Image dimensions are filled after
 * compression; video duration is set client-side from the file metadata
 * and submitted alongside the URL.
 */
@ObjectType()
export class ReviewMedia {
  @Field(() => ID)
  id: string;

  @Field(() => ReviewMediaType)
  type: ReviewMediaType;

  @Field(() => String)
  url: string;

  @Field(() => String, { nullable: true })
  thumbnailUrl?: string | null;

  @Field(() => Int, { nullable: true })
  width?: number | null;

  @Field(() => Int, { nullable: true })
  height?: number | null;

  @Field(() => Int, { nullable: true })
  durationMs?: number | null;

  @Field(() => Int)
  sizeBytes: number;
}

/**
 * A single review row. Customer name comes from the joined Customer.user.name
 * and is non-sensitive (always shown publicly with the review).
 */
@ObjectType()
export class Review {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  productId: string;

  @Field(() => ID)
  customerId: string;

  /** Author display name from the joined Customer.user. */
  @Field(() => String, { nullable: true })
  customerName?: string | null;

  @Field(() => Int)
  rating: number;

  @Field(() => String, { nullable: true })
  title?: string | null;

  @Field(() => String)
  body: string;

  @Field(() => ReviewStatus)
  status: ReviewStatus;

  /** Always true under the v1 eligibility rules (delivered order required). */
  @Field(() => Boolean)
  verifiedPurchase: boolean;

  /** Image + video attachments, in display order. */
  @Field(() => [ReviewMedia])
  media: ReviewMedia[];

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType()
export class PaginatedReviews {
  @Field(() => [Review])
  items: Review[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}

/**
 * Admin-side review shape. Extends Review with the product context +
 * customer email + moderation metadata the queue table needs to render.
 */
@ObjectType()
export class AdminReview extends Review {
  @Field(() => String, { nullable: true })
  customerEmail?: string | null;

  @Field(() => String, { nullable: true })
  productName?: string | null;

  @Field(() => String, { nullable: true })
  productSlug?: string | null;

  @Field(() => String, { nullable: true })
  hiddenReason?: string | null;

  @Field(() => String, { nullable: true })
  hiddenById?: string | null;

  @Field(() => Date, { nullable: true })
  hiddenAt?: Date | null;
}

@ObjectType()
export class PaginatedAdminReviews {
  @Field(() => [AdminReview])
  items: AdminReview[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}

/**
 * Aggregate rating shape for the PDP header — average + per-star distribution.
 * `count1..5` are the absolute counts; the frontend computes percentages
 * from `total` to avoid float drift across queries.
 */
@ObjectType()
export class ProductRatingSummary {
  @Field(() => Int)
  total: number;

  /** Mean rating across all published reviews. 0 when total = 0. */
  @Field(() => Number)
  average: number;

  @Field(() => Int)
  count1: number;
  @Field(() => Int)
  count2: number;
  @Field(() => Int)
  count3: number;
  @Field(() => Int)
  count4: number;
  @Field(() => Int)
  count5: number;
}

/**
 * Eligibility hint surfaced to the PDP. The frontend uses this to decide
 * whether to render "Write a review" vs "You've already reviewed this".
 *
 * The backend re-checks eligibility on every write — the response here is
 * advisory only.
 */
@ObjectType()
export class ReviewEligibility {
  /** True when the customer has a DELIVERED order with this product AND
   *  hasn't already written a review for it. */
  @Field(() => Boolean)
  canReview: boolean;

  /** True when the customer has a DELIVERED order with this product — even
   *  if they've already reviewed it. Drives the "verified" UI hint. */
  @Field(() => Boolean)
  hasPurchased: boolean;

  /** Existing review's id, present iff the customer has one. The PDP uses
   *  this to switch between "Write" and "Edit" CTAs. */
  @Field(() => ID, { nullable: true })
  existingReviewId?: string | null;
}
