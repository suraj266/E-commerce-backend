import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SellerStatus } from '@prisma/client';
import { SellerService } from './seller.service';
import { Seller } from './entities/seller.entity';
import { SellerPayoutAccount } from './entities/seller-payout-account.entity';
import {
  SellerListItem,
  SellerListStatus,
} from './entities/seller-list-item.entity';
import { CreateSellerInput } from './dto/create-seller.input';
import { UpdateSellerInput } from './dto/update-seller.input';
import { AdminCreateSellerInput } from './dto/admin-create-seller.input';
import {
  SetSellerStatusInput,
  VerifySellerSectionInput,
} from './dto/verify-seller.input';
import { CreatePayoutAccountInput } from './dto/create-payout-account.input';
import { UpdatePayoutAccountInput } from './dto/update-payout-account.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

@Resolver(() => Seller)
export class SellerResolver {
  constructor(private readonly sellerService: SellerService) {}

  // ---------------------------------------------------------------------------
  // Self queries (any authenticated user can fetch their own seller record)
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Query(() => Seller, { name: 'mySeller', nullable: true })
  findMine(@CurrentUser() user: CurrentUserPayload) {
    return this.sellerService.findByUserId(user.userId);
  }

  // ---------------------------------------------------------------------------
  // Admin queries
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:read')
  @Query(() => [Seller], { name: 'sellers' })
  findAll(
    @Args('status', { type: () => SellerStatus, nullable: true })
    status?: SellerStatus,
  ) {
    return this.sellerService.findAll(status);
  }

  /**
   * Returns ALL seller-role users with their funnel status — including users
   * who have only registered but not started onboarding.
   */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:read')
  @Query(() => [SellerListItem], { name: 'sellerUsers' })
  findSellerUsers(
    @Args('status', { type: () => SellerListStatus, nullable: true })
    status?: SellerListStatus,
  ) {
    return this.sellerService.findSellerUsers(status);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:read')
  @Query(() => Seller, { name: 'seller' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.sellerService.findOne(id);
  }

  // ---------------------------------------------------------------------------
  // Self-onboarding mutations
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Seller)
  createMySeller(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createSellerInput') input: CreateSellerInput,
  ) {
    return this.sellerService.createSelf(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Seller)
  updateMySeller(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateSellerInput') input: UpdateSellerInput,
  ) {
    return this.sellerService.update(user.userId, input, false);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Seller)
  submitMySellerForReview(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.sellerService.submitForReview(user.userId, id);
  }

  // ---------------------------------------------------------------------------
  // Admin verification mutations
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:create')
  @Mutation(() => Seller)
  adminCreateSeller(@Args('input') input: AdminCreateSellerInput) {
    return this.sellerService.adminCreate(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:update')
  @Mutation(() => Seller)
  adminUpdateSeller(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateSellerInput') input: UpdateSellerInput,
  ) {
    return this.sellerService.update(user.userId, input, true);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:verify')
  @Mutation(() => Seller)
  verifySellerSection(
    @Args('verifySectionInput') input: VerifySellerSectionInput,
  ) {
    return this.sellerService.verifySection(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:verify')
  @Mutation(() => Seller)
  setSellerStatus(@Args('setStatusInput') input: SetSellerStatusInput) {
    return this.sellerService.setStatus(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:delete')
  @Mutation(() => Seller)
  removeSeller(@Args('id', { type: () => ID }) id: string) {
    return this.sellerService.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Payout accounts (seller-self only)
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Mutation(() => SellerPayoutAccount)
  createMyPayoutAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createPayoutAccountInput') input: CreatePayoutAccountInput,
  ) {
    return this.sellerService.addPayoutAccount(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => SellerPayoutAccount)
  updateMyPayoutAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updatePayoutAccountInput') input: UpdatePayoutAccountInput,
  ) {
    return this.sellerService.updatePayoutAccount(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => SellerPayoutAccount)
  removeMyPayoutAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.sellerService.removePayoutAccount(user.userId, id);
  }
}
