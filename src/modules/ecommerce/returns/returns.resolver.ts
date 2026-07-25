/**
 * ReturnsResolver — customer + seller return surfaces.
 *
 * Customer opens/tracks a return on their own delivered order; the seller works
 * their return queue (approve / schedule reverse pickup / mark received / QC).
 * Ownership is enforced in ReturnsService (customer-id / seller-id scoping), so
 * these use only JwtAuthGuard — the same shape as RefundResolver.
 */

import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ReturnStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { ReturnsService } from './returns.service';
import {
  ReturnRequestEntity,
  PaginatedReturns,
} from './entities/return.entity';
import { RequestReturnInput } from './dto/request-return.input';

@Resolver()
export class ReturnsResolver {
  constructor(private readonly returns: ReturnsService) {}

  // --------------------------- Customer -------------------------------------

  /** Customer opens a return against one delivered seller-order (window + qty gated). Auth: logged-in customer. */
  @Mutation(() => ReturnRequestEntity, { name: 'requestReturn' })
  @UseGuards(JwtAuthGuard)
  async requestReturn(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: RequestReturnInput,
  ) {
    return this.returns.requestReturn(user.userId, input);
  }

  /** Customer's own returns, most-recent first. Auth: logged-in customer. */
  @Query(() => [ReturnRequestEntity], { name: 'myReturns' })
  @UseGuards(JwtAuthGuard)
  async myReturns(@CurrentUser() user: CurrentUserPayload) {
    return this.returns.myReturns(user.userId);
  }

  /** Customer views one of their own returns with its event timeline. Auth: logged-in customer. */
  @Query(() => ReturnRequestEntity, { name: 'myReturn' })
  @UseGuards(JwtAuthGuard)
  async myReturn(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.returns.myReturnDetail(user.userId, id);
  }

  // --------------------------- Seller ---------------------------------------

  /** Seller's paginated return queue, optionally filtered by status. Auth: logged-in seller. */
  @Query(() => PaginatedReturns, { name: 'sellerReturns' })
  @UseGuards(JwtAuthGuard)
  async sellerReturns(
    @CurrentUser() user: CurrentUserPayload,
    @Args('page', { type: () => Int, defaultValue: 1 }) page: number,
    @Args('pageSize', { type: () => Int, defaultValue: 10 }) pageSize: number,
    @Args('status', { type: () => ReturnStatus, nullable: true })
    status?: ReturnStatus,
  ) {
    return this.returns.sellerReturns(user.userId, { page, pageSize, status });
  }

  /** Seller views one return from their own queue. Auth: logged-in seller. */
  @Query(() => ReturnRequestEntity, { name: 'sellerReturn' })
  @UseGuards(JwtAuthGuard)
  async sellerReturn(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.returns.sellerReturnDetail(user.userId, id);
  }

  /** Seller approves a requested return (REQUESTED → APPROVED); emails the customer. Auth: logged-in seller. */
  @Mutation(() => ReturnRequestEntity, { name: 'approveReturn' })
  @UseGuards(JwtAuthGuard)
  async approveReturn(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.returns.approveReturn(user.userId, id);
  }

  /** Seller rejects a return with an optional reason (no refund). Auth: logged-in seller. */
  @Mutation(() => ReturnRequestEntity, { name: 'rejectReturn' })
  @UseGuards(JwtAuthGuard)
  async rejectReturn(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('reason', { type: () => String, nullable: true }) reason?: string,
  ) {
    return this.returns.rejectReturn(user.userId, id, reason);
  }

  /** Seller schedules the reverse pickup, generating a reverse AWB (manual-pickup fallback if no courier). Auth: logged-in seller. */
  @Mutation(() => ReturnRequestEntity, { name: 'scheduleReturnPickup' })
  @UseGuards(JwtAuthGuard)
  async scheduleReturnPickup(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.returns.scheduleReturnPickup(user.userId, id);
  }

  /** Seller confirms the returned parcel is physically back (manual RECEIVED). Auth: logged-in seller. */
  @Mutation(() => ReturnRequestEntity, { name: 'markReturnReceived' })
  @UseGuards(JwtAuthGuard)
  async markReturnReceived(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.returns.markReturnReceived(user.userId, id);
  }

  /** Seller records the QC decision; pass fans out to refund or replacement, fail → QC_FAILED (no refund). Auth: logged-in seller. */
  @Mutation(() => ReturnRequestEntity, { name: 'qcReturn' })
  @UseGuards(JwtAuthGuard)
  async qcReturn(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('pass', { type: () => Boolean }) pass: boolean,
    @Args('note', { type: () => String, nullable: true }) note?: string,
  ) {
    return this.returns.qcReturn(user.userId, id, pass, note);
  }

  /** REPLACEMENT arm: seller marks the swap unit shipped (+ optional reference). */
  @Mutation(() => ReturnRequestEntity, { name: 'markReplacementShipped' })
  @UseGuards(JwtAuthGuard)
  async markReplacementShipped(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('reference', { type: () => String, nullable: true }) reference?: string,
    @Args('note', { type: () => String, nullable: true }) note?: string,
  ) {
    return this.returns.markReplacementShipped(user.userId, id, reference, note);
  }
}
