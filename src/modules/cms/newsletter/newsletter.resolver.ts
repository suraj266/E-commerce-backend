import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { NewsletterStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { NewsletterService } from './newsletter.service';
import {
  NewsletterSubscription,
  PaginatedNewsletterSubscriptions,
  NewsletterSubscribeResult,
} from './entities/newsletter-subscription.entity';
import { SubscribeNewsletterInput } from './dto/subscribe-newsletter.input';

@Resolver(() => NewsletterSubscription)
export class NewsletterResolver {
  constructor(private readonly newsletterService: NewsletterService) {}

  // ---------------------------------------------------------------------------
  // Public — newsletter signup block calls this from the storefront.
  // ---------------------------------------------------------------------------

  /** Public storefront newsletter signup; double opt-in — sends a confirmation email, not yet marketable. Public. */
  @Mutation(() => NewsletterSubscribeResult)
  subscribeToNewsletter(@Args('input') input: SubscribeNewsletterInput) {
    return this.newsletterService.subscribe(input);
  }

  /**
   * Public double opt-in confirmation — the storefront confirmation page calls
   * this with the token from the emailed link. Returns true when the address is
   * now ACTIVE (including an idempotent re-click), false for an unknown/expired/
   * unsubscribed token.
   */
  @Mutation(() => Boolean, { name: 'confirmNewsletter' })
  confirmNewsletter(@Args('token', { type: () => String }) token: string) {
    return this.newsletterService.confirmNewsletter(token);
  }

  /**
   * Public one-click unsubscribe (P3 Wave 4) — the storefront unsubscribe page
   * calls this with the token from a broadcast email's link. Returns true when
   * the address is now UNSUBSCRIBED (including an idempotent re-click), false for
   * an unknown/blank token. No auth: the unguessable token IS the authorization.
   */
  @Mutation(() => Boolean, { name: 'unsubscribeFromNewsletter' })
  unsubscribeFromNewsletter(
    @Args('token', { type: () => String }) token: string,
  ) {
    return this.newsletterService.unsubscribeByToken(token);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  /** Paginated admin list of subscribers (filter by status/search). Auth: newsletter:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('newsletter:read')
  @Query(() => PaginatedNewsletterSubscriptions, {
    name: 'adminNewsletterSubscriptions',
  })
  adminNewsletterSubscriptions(
    @Args('status', { type: () => NewsletterStatus, nullable: true })
    status?: NewsletterStatus,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ) {
    return this.newsletterService.findAllPaginated({
      status,
      page,
      pageSize,
      search,
    });
  }

  /** Admin force-unsubscribes a subscriber by id. Auth: newsletter:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('newsletter:update')
  @Mutation(() => NewsletterSubscription)
  unsubscribeNewsletter(@Args('id', { type: () => ID }) id: string) {
    return this.newsletterService.unsubscribe(id);
  }
}
