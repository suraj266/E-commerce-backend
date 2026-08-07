/**
 * ReviewService — customer write/edit/delete + public list + summary.
 *
 * Eligibility (enforced on every write — never trust client hints):
 *   - The caller must have a DELIVERED order containing this product
 *   - No existing review for (productId, customerId) when creating
 *   - Editing/deleting only your own review
 *
 * Aggregate summary is computed on demand via groupBy. For a v2 with
 * very large review volume, swap to a denormalised `Product.ratingAvg` +
 * `Product.ratingCount` column refreshed via trigger / bg job.
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { EmailService } from '@/modules/admin/email/email.service';
import { config } from '@/common/config/config';

import { CreateReviewInput } from './dto/create-review.input';
import { UpdateReviewInput } from './dto/update-review.input';

const REVIEW_INCLUDE = {
  customer: { include: { user: { select: { name: true, avatarUrl: true } } } },
  media: { orderBy: { displayOrder: 'asc' as const } },
} as const;

const MAX_IMAGES_PER_REVIEW = 5;
const MAX_VIDEOS_PER_REVIEW = 1;

@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Identity helper
  // ---------------------------------------------------------------------------

  private async getCustomerId(userId: string): Promise<string> {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!customer) {
      throw new ForbiddenException('Reviews are only available to customers.');
    }
    if (customer.deletedAt) {
      throw new ForbiddenException('This account has been archived.');
    }
    return customer.id;
  }

  /** Returns the most-recent DELIVERED order id for (customer, product), or null. */
  private async findDeliveringOrderId(
    customerId: string,
    productId: string,
  ): Promise<string | null> {
    const row = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: {
          customerId,
          deletedAt: null,
          status: OrderStatus.DELIVERED,
        },
      },
      select: { orderId: true },
      orderBy: { createdAt: 'desc' },
    });
    return row?.orderId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Customer writes
  // ---------------------------------------------------------------------------

  async create(userId: string, input: CreateReviewInput) {
    const customerId = await this.getCustomerId(userId);

    const orderId = await this.findDeliveringOrderId(customerId, input.productId);
    if (!orderId) {
      throw new ForbiddenException(
        'You can only review products from delivered orders.',
      );
    }

    // Reject if a review already exists — the @@unique would also catch
    // this, but a friendlier message is worth the extra round trip.
    const existing = await this.prisma.review.findUnique({
      where: {
        productId_customerId: { productId: input.productId, customerId },
      },
    });
    if (existing) {
      throw new BadRequestException(
        'You have already reviewed this product. Edit your existing review instead.',
      );
    }

    // Validate per-type media caps before opening the transaction.
    const media = input.media ?? [];
    this.assertMediaCaps(media);

    const row = await this.prisma.review.create({
      data: {
        productId: input.productId,
        customerId,
        orderId,
        rating: input.rating,
        title: input.title?.trim() || null,
        body: input.body.trim(),
        // PENDING by default — admin approves before public surfaces it.
        // Public queries filter to PUBLISHED, so a pending review is
        // private to its author and to admins.
        status: ReviewStatus.PENDING,
        media: media.length
          ? {
              create: media.map((m, i) => ({
                type: m.type,
                url: m.url,
                width: m.width ?? null,
                height: m.height ?? null,
                durationMs: m.durationMs ?? null,
                sizeBytes: m.sizeBytes,
                displayOrder: i,
              })),
            }
          : undefined,
      },
      include: {
        ...REVIEW_INCLUDE,
        product: { select: { name: true } },
      },
    });
    this.logger.log(
      `Review created (PENDING): product=${input.productId} customer=${customerId} rating=${input.rating}`,
    );

    // Notify admin out-of-band — soft-fail so a missing template / SMTP
    // glitch doesn't block the customer's submit.
    this.notifyAdminOfNewReview(row).catch((err) =>
      this.logger.warn(
        `admin_new_review email failed: ${(err as Error).message}`,
      ),
    );

    return this.hydrate(row);
  }

  async update(userId: string, input: UpdateReviewInput) {
    const customerId = await this.getCustomerId(userId);
    const existing = await this.prisma.review.findUnique({
      where: { id: input.id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Review not found.');
    }
    if (existing.customerId !== customerId) {
      throw new ForbiddenException('You can only edit your own review.');
    }
    if (existing.status === ReviewStatus.HIDDEN) {
      throw new BadRequestException(
        'This review has been hidden by an administrator and cannot be edited.',
      );
    }

    const data: Prisma.ReviewUpdateInput = {};
    if (input.rating != null) data.rating = input.rating;
    if (input.title !== undefined) {
      data.title = input.title?.trim() || null;
    }
    if (input.body != null) data.body = input.body.trim();

    // Edits re-enter the moderation queue. A previously-published review
    // that the customer changes goes back to PENDING so the admin can see
    // the new content before it goes public again.
    const hasContentChange =
      data.rating !== undefined ||
      data.title !== undefined ||
      data.body !== undefined ||
      input.media !== undefined;
    if (hasContentChange && existing.status === ReviewStatus.PUBLISHED) {
      data.status = ReviewStatus.PENDING;
    }

    // Media is replace-wholesale: omit to leave alone, send [] to clear,
    // send a list to replace. Done inside a single transaction so we
    // never leave orphan rows.
    const media = input.media;
    if (media !== undefined) {
      this.assertMediaCaps(media);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (media !== undefined) {
        await tx.reviewMedia.deleteMany({ where: { reviewId: existing.id } });
        if (media.length > 0) {
          await tx.reviewMedia.createMany({
            data: media.map((m, i) => ({
              reviewId: existing.id,
              type: m.type,
              url: m.url,
              width: m.width ?? null,
              height: m.height ?? null,
              durationMs: m.durationMs ?? null,
              sizeBytes: m.sizeBytes,
              displayOrder: i,
            })),
          });
        }
      }
      return tx.review.update({
        where: { id: existing.id },
        data,
        include: REVIEW_INCLUDE,
      });
    });
    return this.hydrate(row);
  }

  /**
   * Guards against more attachments than allowed per type. Better here
   * than in the DTO because both create + update share the rule + we
   * want a friendly error message that mentions the cap.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private assertMediaCaps(media: any[]) {
    const images = media.filter((m) => m.type === 'IMAGE');
    const videos = media.filter((m) => m.type === 'VIDEO');
    if (images.length > MAX_IMAGES_PER_REVIEW) {
      throw new BadRequestException(
        `At most ${MAX_IMAGES_PER_REVIEW} images per review (got ${images.length}).`,
      );
    }
    if (videos.length > MAX_VIDEOS_PER_REVIEW) {
      throw new BadRequestException(
        `At most ${MAX_VIDEOS_PER_REVIEW} video per review (got ${videos.length}).`,
      );
    }
  }

  async delete(userId: string, id: string) {
    const customerId = await this.getCustomerId(userId);
    const existing = await this.prisma.review.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Review not found.');
    }
    if (existing.customerId !== customerId) {
      throw new ForbiddenException('You can only delete your own review.');
    }
    // Soft-delete so historical product rating summaries stay reproducible.
    await this.prisma.review.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Customer reads
  // ---------------------------------------------------------------------------

  /**
   * The caller's own reviews, newest first, for the account "My reviews" page.
   * Scoped to the resolved customerId — never trusts a client-supplied id.
   * Hydrates productName + productSlug so the list can label + link each row.
   */
  async myReviews(userId: string) {
    const customerId = await this.getCustomerId(userId);
    const rows = await this.prisma.review.findMany({
      where: { customerId, deletedAt: null },
      include: {
        ...REVIEW_INCLUDE,
        product: { select: { name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      ...this.hydrate(r),
      productName: r.product?.name ?? null,
      productSlug: r.product?.slug ?? null,
    }));
  }

  /** Returns the caller's review for `productId`, if any. */
  async myReview(userId: string, productId: string) {
    const customerId = await this.getCustomerId(userId);
    const row = await this.prisma.review.findUnique({
      where: { productId_customerId: { productId, customerId } },
      include: REVIEW_INCLUDE,
    });
    return row && !row.deletedAt ? this.hydrate(row) : null;
  }

  /** Lightweight check used by the PDP "Write / Edit review" button. */
  async eligibility(userId: string, productId: string) {
    const customerId = await this.getCustomerId(userId).catch(() => null);
    if (!customerId) {
      return { canReview: false, hasPurchased: false, existingReviewId: null };
    }
    const [deliveringOrderId, existingReview] = await Promise.all([
      this.findDeliveringOrderId(customerId, productId),
      this.prisma.review.findUnique({
        where: { productId_customerId: { productId, customerId } },
        select: { id: true, deletedAt: true },
      }),
    ]);
    const hasPurchased = deliveringOrderId != null;
    const existing =
      existingReview && !existingReview.deletedAt ? existingReview : null;
    return {
      canReview: hasPurchased && !existing,
      hasPurchased,
      existingReviewId: existing?.id ?? null,
    };
  }

  // ---------------------------------------------------------------------------
  // Public reads
  // ---------------------------------------------------------------------------

  async publicList(args: {
    productId: string;
    page?: number;
    pageSize?: number;
    /** Optional filter: only show this exact rating. */
    rating?: number;
    /** 'newest' (default) or 'highest' / 'lowest'. */
    sort?: 'newest' | 'highest' | 'lowest';
  }) {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(Math.max(args.pageSize ?? 10, 1), 50);

    const where: Prisma.ReviewWhereInput = {
      productId: args.productId,
      status: ReviewStatus.PUBLISHED,
      deletedAt: null,
      ...(args.rating ? { rating: args.rating } : {}),
    };

    let orderBy: Prisma.ReviewOrderByWithRelationInput = { createdAt: 'desc' };
    if (args.sort === 'highest') orderBy = { rating: 'desc' };
    if (args.sort === 'lowest') orderBy = { rating: 'asc' };

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        include: REVIEW_INCLUDE,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.hydrate(r)),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  /** Aggregate rating summary for the PDP header. */
  async summary(productId: string) {
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where: {
        productId,
        status: ReviewStatus.PUBLISHED,
        deletedAt: null,
      },
      _count: { _all: true },
    });

    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const g of grouped) {
      if (g.rating >= 1 && g.rating <= 5) counts[g.rating] = g._count._all;
    }
    const total =
      counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
    const weighted =
      counts[1] * 1 +
      counts[2] * 2 +
      counts[3] * 3 +
      counts[4] * 4 +
      counts[5] * 5;
    const average = total === 0 ? 0 : Math.round((weighted / total) * 10) / 10;

    return {
      total,
      average,
      count1: counts[1],
      count2: counts[2],
      count3: counts[3],
      count4: counts[4],
      count5: counts[5],
    };
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  /**
   * Admin moderation list. Defaults to PENDING so the queue surfaces what
   * needs attention. Search matches title or body (ILIKE).
   */
  async adminList(args: {
    status?: 'PENDING' | 'PUBLISHED' | 'HIDDEN' | null;
    search?: string | null;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(Math.max(args.pageSize ?? 25, 1), 100);
    const status = args.status ?? 'PENDING';
    const search = (args.search ?? '').trim();

    const where: Prisma.ReviewWhereInput = {
      deletedAt: null,
      status: status as ReviewStatus,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { body: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        include: {
          customer: { include: { user: { select: { name: true, email: true } } } },
          product: { select: { id: true, name: true, slug: true } },
        },
        // PENDING first (oldest pending → most urgent), then anything else
        // by recency. createdAt asc surfaces the queue order intuitively.
        orderBy:
          status === 'PENDING'
            ? { createdAt: 'asc' }
            : { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.hydrateAdmin(r)),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  /** Admin → flip a review to PUBLISHED. */
  async approve(adminUserId: string, id: string) {
    const existing = await this.prisma.review.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Review not found.');
    }
    const row = await this.prisma.review.update({
      where: { id },
      data: {
        status: ReviewStatus.PUBLISHED,
        // Clear any prior hide-metadata if this was rejected then re-approved.
        hiddenReason: null,
        hiddenById: null,
        hiddenAt: null,
      },
      include: {
        customer: { include: { user: { select: { name: true, email: true } } } },
        product: { select: { id: true, name: true, slug: true } },
      },
    });
    this.logger.log(`Review ${id} approved by ${adminUserId}`);

    // Notify the customer their review is live.
    const customerEmail = row.customer?.user?.email;
    if (customerEmail) {
      this.email
        .send('review_approved', customerEmail, {
          customerName: row.customer?.user?.name ?? 'there',
          productName: row.product?.name ?? 'your product',
          productLink: `${config.FRONTEND_URL ?? ''}/product/${row.product?.slug ?? ''}`,
        })
        .catch((err) =>
          this.logger.warn(
            `review_approved email failed: ${(err as Error).message}`,
          ),
        );
    }

    return this.hydrateAdmin(row);
  }

  /** Admin → hide a review with a reason captured in the audit fields. */
  async reject(adminUserId: string, id: string, reason?: string) {
    const existing = await this.prisma.review.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException('Review not found.');
    }
    const row = await this.prisma.review.update({
      where: { id },
      data: {
        status: ReviewStatus.HIDDEN,
        hiddenReason: reason?.trim() || null,
        hiddenById: adminUserId,
        hiddenAt: new Date(),
      },
      include: {
        customer: { include: { user: { select: { name: true, email: true } } } },
        product: { select: { id: true, name: true, slug: true } },
      },
    });
    this.logger.log(`Review ${id} rejected by ${adminUserId}`);

    const customerEmail = row.customer?.user?.email;
    if (customerEmail) {
      this.email
        .send('review_rejected', customerEmail, {
          customerName: row.customer?.user?.name ?? 'there',
          productName: row.product?.name ?? 'your product',
          productLink: `${config.FRONTEND_URL ?? ''}/product/${row.product?.slug ?? ''}`,
          reason: reason?.trim() || '',
        })
        .catch((err) =>
          this.logger.warn(
            `review_rejected email failed: ${(err as Error).message}`,
          ),
        );
    }

    return this.hydrateAdmin(row);
  }

  /**
   * Notifies the first admin user(s) by email when a new review is pending
   * moderation. Pulls all `superAdmin` accounts (typically just one) and
   * sends to each. No-op if no admin email is on file.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async notifyAdminOfNewReview(row: any): Promise<void> {
    const admins = await this.prisma.user.findMany({
      where: {
        role: { name: 'superAdmin' },
        status: 'active',
      },
      select: { email: true },
    });
    if (admins.length === 0) return;

    const reviewLink = `${config.FRONTEND_URL ?? ''}/admin/reviews`;
    const ctx = {
      productName: row.product?.name ?? 'a product',
      customerName: row.customer?.user?.name ?? 'a customer',
      rating: String(row.rating),
      title: row.title ?? '',
      body: row.body,
      reviewLink,
    };
    for (const a of admins) {
      if (!a.email) continue;
      await this.email.send('admin_new_review', a.email, ctx);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrate(row: any) {
    return {
      id: row.id,
      productId: row.productId,
      customerId: row.customerId,
      customerName: row.customer?.user?.name ?? null,
      customerAvatarUrl: row.customer?.user?.avatarUrl ?? null,
      rating: row.rating,
      title: row.title,
      body: row.body,
      status: row.status,
      // Under v1 every review is gated by a DELIVERED order, so verified is
      // always true. Keeping the field on the entity lets v2 introduce
      // unverified reviews (testers, sample seeds) without a breaking schema.
      verifiedPurchase: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      media: (row.media ?? []).map((m: any) => ({
        id: m.id,
        type: m.type,
        url: m.url,
        thumbnailUrl: m.thumbnailUrl,
        width: m.width,
        height: m.height,
        durationMs: m.durationMs,
        sizeBytes: m.sizeBytes,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Admin shape — includes the product + customer email so the moderation
   * table can show context, and the hide-metadata for audit display.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrateAdmin(row: any) {
    return {
      ...this.hydrate(row),
      customerEmail: row.customer?.user?.email ?? null,
      productName: row.product?.name ?? null,
      productSlug: row.product?.slug ?? null,
      hiddenReason: row.hiddenReason ?? null,
      hiddenById: row.hiddenById ?? null,
      hiddenAt: row.hiddenAt ?? null,
    };
  }
}
