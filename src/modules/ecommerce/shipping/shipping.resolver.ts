import { Resolver, Query, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingQuote } from './entities/shipping-quote.entity';
import { ShippingQuoteInput } from './dto/shipping-quote.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

@Resolver(() => ShippingQuote)
export class ShippingResolver {
  constructor(private readonly shippingService: ShippingService) {}

  /** Preview shipping + COD eligibility for the current cart (cart/checkout). */
  @UseGuards(JwtAuthGuard)
  @Query(() => ShippingQuote, { name: 'shippingQuote' })
  shippingQuote(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: ShippingQuoteInput,
  ) {
    return this.shippingService.quote(user.userId, input);
  }
}
