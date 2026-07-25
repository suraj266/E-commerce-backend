import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { AddressService } from './address.service';
import { Address } from './entities/address.entity';
import { CreateAddressInput } from './dto/create-address.input';
import { UpdateAddressInput } from './dto/update-address.input';

@Resolver(() => Address)
@UseGuards(JwtAuthGuard)
export class AddressResolver {
  constructor(private readonly addressService: AddressService) {}

  /** Lists the caller's saved addresses, default first. Auth: logged-in user. */
  @Query(() => [Address], { name: 'myAddresses' })
  myAddresses(@CurrentUser() user: CurrentUserPayload) {
    return this.addressService.myAddresses(user.userId);
  }

  /** Adds an address for the caller; the first-ever address is forced default. Auth: logged-in user. */
  @Mutation(() => Address)
  addMyAddress(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: CreateAddressInput,
  ) {
    return this.addressService.create(user.userId, input);
  }

  /** Edits one of the caller's addresses; unsetting the last default is rejected. Auth: logged-in user. */
  @Mutation(() => Address)
  updateMyAddress(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateAddressInput,
  ) {
    return this.addressService.update(user.userId, input);
  }

  /** Promotes one of the caller's addresses to default, demoting the rest. Auth: logged-in user. */
  @Mutation(() => Address)
  setMyDefaultAddress(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.addressService.setDefault(user.userId, id);
  }

  /** Hard-deletes one of the caller's addresses; auto-promotes another if it was default. Auth: logged-in user. */
  @Mutation(() => Address)
  removeMyAddress(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.addressService.remove(user.userId, id);
  }
}
