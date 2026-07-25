import { Module } from '@nestjs/common';
import { CartService } from './cart.service';
import { CartResolver } from './cart.resolver';
import { GuestCartResolver } from './guest-cart.resolver';

@Module({
  providers: [CartService, CartResolver, GuestCartResolver],
  exports: [CartService],
})
export class CartModule {}
