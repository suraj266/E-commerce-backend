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

  @Mutation(() => NewsletterSubscribeResult)
  subscribeToNewsletter(@Args('input') input: SubscribeNewsletterInput) {
    return this.newsletterService.subscribe(input);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

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

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('newsletter:update')
  @Mutation(() => NewsletterSubscription)
  unsubscribeNewsletter(@Args('id', { type: () => ID }) id: string) {
    return this.newsletterService.unsubscribe(id);
  }
}
