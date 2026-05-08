import { Injectable, NotFoundException } from '@nestjs/common';
import { NewsletterStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { SubscribeNewsletterInput } from './dto/subscribe-newsletter.input';

@Injectable()
export class NewsletterService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent public subscribe. Creates a new ACTIVE row, or revives an
   * UNSUBSCRIBED row, or no-ops on an existing ACTIVE row. Always succeeds
   * for valid emails — never leaks whether an address was already on file
   * (privacy + scraping resistance).
   */
  async subscribe(input: SubscribeNewsletterInput) {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.newsletterSubscription.findUnique({
      where: { email },
    });

    if (!existing) {
      await this.prisma.newsletterSubscription.create({
        data: {
          email,
          source: input.source ?? null,
          status: NewsletterStatus.ACTIVE,
        },
      });
      return { ok: true, message: 'subscribed' };
    }

    if (existing.status === NewsletterStatus.UNSUBSCRIBED) {
      await this.prisma.newsletterSubscription.update({
        where: { id: existing.id },
        data: {
          status: NewsletterStatus.ACTIVE,
          unsubscribedAt: null,
          source: input.source ?? existing.source,
        },
      });
      return { ok: true, message: 'resubscribed' };
    }

    return { ok: true, message: 'already-subscribed' };
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async findAllPaginated(opts: {
    status?: NewsletterStatus;
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: Prisma.NewsletterSubscriptionWhereInput = {};
    if (opts.status) where.status = opts.status;
    if (opts.search && opts.search.trim()) {
      where.email = { contains: opts.search.trim(), mode: 'insensitive' };
    }

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.newsletterSubscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.newsletterSubscription.count({ where }),
    ]);

    return {
      items,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  async unsubscribe(id: string) {
    const row = await this.prisma.newsletterSubscription.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Subscription not found');
    return this.prisma.newsletterSubscription.update({
      where: { id },
      data: {
        status: NewsletterStatus.UNSUBSCRIBED,
        unsubscribedAt: new Date(),
      },
    });
  }
}
