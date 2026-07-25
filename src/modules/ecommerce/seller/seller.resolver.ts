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

  /** The caller's own seller record (null if they haven't onboarded). Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Query(() => Seller, { name: 'mySeller', nullable: true })
  findMine(@CurrentUser() user: CurrentUserPayload) {
    return this.sellerService.findByUserId(user.userId);
  }

  // ---------------------------------------------------------------------------
  // Admin queries
  // ---------------------------------------------------------------------------

  /** List seller profiles, optionally filtered by overall status. Auth: seller:read permission. */
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

  /** One seller profile by id. Auth: seller:read permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:read')
  @Query(() => Seller, { name: 'seller' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.sellerService.findOne(id);
  }

  // ---------------------------------------------------------------------------
  // Self-onboarding mutations
  // ---------------------------------------------------------------------------

  /** Start seller onboarding — creates the caller's own DRAFT seller profile. Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Seller)
  createMySeller(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createSellerInput') input: CreateSellerInput,
  ) {
    return this.sellerService.createSelf(user.userId, input);
  }

  /** Update the caller's own seller profile (only in DRAFT/REJECTED state). Auth: logged-in user. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Seller)
  updateMySeller(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateSellerInput') input: UpdateSellerInput,
  ) {
    return this.sellerService.update(user.userId, input, false);
  }

  /** Submit the caller's DRAFT profile for KYC review (DRAFT → PENDING; alerts admins). Auth: logged-in user. */
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

  /** Admin creates a seller-role user + pre-VERIFIED seller record atomically. Auth: seller:create permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:create')
  @Mutation(() => Seller)
  adminCreateSeller(@Args('input') input: AdminCreateSellerInput) {
    return this.sellerService.adminCreate(input);
  }

  /** Admin edits any seller profile, bypassing the DRAFT/REJECTED-only restriction. Auth: seller:update permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:update')
  @Mutation(() => Seller)
  adminUpdateSeller(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateSellerInput') input: UpdateSellerInput,
  ) {
    return this.sellerService.update(user.userId, input, true);
  }

  /** Mark one KYC section (PAN/GSTIN/bank/docs) verified; auto-advances to VERIFIED when all pass. Auth: seller:verify permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:verify')
  @Mutation(() => Seller)
  verifySellerSection(
    @Args('verifySectionInput') input: VerifySellerSectionInput,
  ) {
    return this.sellerService.verifySection(input);
  }

  /** Directly set overall seller status; enqueues the KYC approved/rejected email on genuine transitions. Auth: seller:verify permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:verify')
  @Mutation(() => Seller)
  setSellerStatus(@Args('setStatusInput') input: SetSellerStatusInput) {
    return this.sellerService.setStatus(input);
  }

  /** Soft-delete a seller. Auth: seller:delete permission. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('seller:delete')
  @Mutation(() => Seller)
  removeSeller(@Args('id', { type: () => ID }) id: string) {
    return this.sellerService.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Payout accounts (seller-self only)
  // ---------------------------------------------------------------------------

  /** Add a payout account to the caller's own seller (seller must be VERIFIED). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => SellerPayoutAccount)
  createMyPayoutAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createPayoutAccountInput') input: CreatePayoutAccountInput,
  ) {
    return this.sellerService.addPayoutAccount(user.userId, input);
  }

  /** Update one of the caller's own payout accounts (setting primary demotes the others). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => SellerPayoutAccount)
  updateMyPayoutAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updatePayoutAccountInput') input: UpdatePayoutAccountInput,
  ) {
    return this.sellerService.updatePayoutAccount(user.userId, input);
  }

  /** Soft-delete one of the caller's own payout accounts. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => SellerPayoutAccount)
  removeMyPayoutAccount(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.sellerService.removePayoutAccount(user.userId, id);
  }
}
