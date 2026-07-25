import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { CustomerService } from './customer.service';
import {
  AdminCustomer,
  PaginatedAdminCustomers,
} from './entities/customer.entity';
import { UpdateCustomerInput } from './dto/update-customer.input';
import { UpdateMyProfileInput } from './dto/update-my-profile.input';

@Resolver(() => AdminCustomer)
export class CustomerResolver {
  constructor(private readonly customerService: CustomerService) {}

  // ---------------------------------------------------------------------------
  // Admin list + detail
  // ---------------------------------------------------------------------------

  /** Admin lists customers with search/status filters + pagination. Auth: customer:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('customer:read')
  @Query(() => PaginatedAdminCustomers, { name: 'adminCustomers' })
  adminCustomers(
    @Args('status', { type: () => String, nullable: true }) status?: string,
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('includeDeleted', { type: () => Boolean, nullable: true })
    includeDeleted?: boolean,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
  ) {
    return this.customerService.findAllPaginated({
      status,
      search,
      includeDeleted,
      page,
      pageSize,
    });
  }

  /** Admin fetches one customer's full profile by id. Auth: customer:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('customer:read')
  @Query(() => AdminCustomer, { name: 'adminCustomer' })
  adminCustomer(@Args('id', { type: () => ID }) id: string) {
    return this.customerService.findOneAdmin(id);
  }

  // ---------------------------------------------------------------------------
  // Admin mutations
  // ---------------------------------------------------------------------------

  /** Admin edits a customer (name/phone/status on User; marketing/currency on Customer). Auth: customer:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('customer:update')
  @Mutation(() => AdminCustomer)
  updateCustomer(@Args('input') input: UpdateCustomerInput) {
    return this.customerService.update(input);
  }

  /** Admin soft-deletes a customer and forces the User inactive (blocks login). Auth: customer:delete permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('customer:delete')
  @Mutation(() => AdminCustomer)
  softDeleteCustomer(@Args('id', { type: () => ID }) id: string) {
    return this.customerService.softDelete(id);
  }

  /** Admin restores a soft-deleted customer and reactivates the User. Auth: customer:delete permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('customer:delete')
  @Mutation(() => AdminCustomer)
  restoreCustomer(@Args('id', { type: () => ID }) id: string) {
    return this.customerService.restore(id);
  }

  // ---------------------------------------------------------------------------
  // Customer self-serve
  // ---------------------------------------------------------------------------

  /** Customer reads their own profile; customer accounts only. Auth: logged-in customer. */
  @UseGuards(JwtAuthGuard)
  @Query(() => AdminCustomer, { name: 'myProfile' })
  myProfile(@CurrentUser() user: CurrentUserPayload) {
    return this.customerService.myProfile(user.userId);
  }

  /** Customer updates their own name/phone/marketing/currency; email & status not settable here. Auth: logged-in customer. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => AdminCustomer)
  updateMyProfile(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateMyProfileInput,
  ) {
    return this.customerService.updateMyProfile(user.userId, input);
  }
}
