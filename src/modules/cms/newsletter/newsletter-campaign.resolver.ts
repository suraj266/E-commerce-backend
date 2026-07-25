import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NewsletterCampaignStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { NewsletterService } from './newsletter.service';
import {
  NewsletterCampaign,
  PaginatedNewsletterCampaigns,
} from './entities/newsletter-campaign.entity';
import { CreateNewsletterCampaignInput } from './dto/create-newsletter-campaign.input';

/**
 * Admin broadcast console (P3 Wave 4). Composing/sending a campaign is gated on
 * `newsletter:send` (a strictly higher bar than the existing `newsletter:read`
 * subscriber-list view, since a send fans marketing mail out to every consenting
 * subscriber). Listing/inspecting reuses `newsletter:read`.
 */
@Resolver(() => NewsletterCampaign)
export class NewsletterCampaignResolver {
  constructor(private readonly newsletterService: NewsletterService) {}

  /** Paginated admin list of broadcast campaigns (filter by status/search). Auth: newsletter:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('newsletter:read')
  @Query(() => PaginatedNewsletterCampaigns, {
    name: 'adminNewsletterCampaigns',
  })
  adminNewsletterCampaigns(
    @Args('status', { type: () => NewsletterCampaignStatus, nullable: true })
    status?: NewsletterCampaignStatus,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ) {
    return this.newsletterService.findCampaignsPaginated({
      status,
      page,
      pageSize,
      search,
    });
  }

  /** Fetch one broadcast campaign by id. Auth: newsletter:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('newsletter:read')
  @Query(() => NewsletterCampaign, { name: 'adminNewsletterCampaign' })
  adminNewsletterCampaign(@Args('id', { type: () => ID }) id: string) {
    return this.newsletterService.findCampaign(id);
  }

  /** Compose a new DRAFT campaign; no recipients are touched until it is sent. Auth: newsletter:send. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('newsletter:send')
  @Mutation(() => NewsletterCampaign)
  createNewsletterCampaign(
    @Args('input') input: CreateNewsletterCampaignInput,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.newsletterService.createCampaign(input, user?.userId);
  }

  /**
   * Kick off the durable, consent-gated fan-out. Returns immediately with the
   * campaign flipped to SENDING (the per-recipient work drains via the outbox).
   * Idempotent — a second call on an already-SENDING/SENT campaign is a no-op.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('newsletter:send')
  @Mutation(() => NewsletterCampaign)
  sendNewsletterCampaign(@Args('id', { type: () => ID }) id: string) {
    return this.newsletterService.sendCampaign(id);
  }
}
