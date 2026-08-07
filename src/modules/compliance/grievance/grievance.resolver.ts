/**
 * GrievanceResolver — customer complaint surface (CP-EC, P4-01).
 *
 * A logged-in customer files a complaint, tracks their own complaints, and
 * replies on the thread. Ownership is enforced in GrievanceService (scoped to
 * raisedByUserId), so these use only JwtAuthGuard — the same shape as
 * ReturnsResolver. Internal officer notes are filtered out of everything this
 * resolver returns.
 */

import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { GrievanceService } from './grievance.service';
import { GrievanceEntity } from './entities/grievance.entities';
import { FileGrievanceInput } from './dto/file-grievance.input';

@Resolver()
@UseGuards(JwtAuthGuard)
export class GrievanceResolver {
  constructor(private readonly grievance: GrievanceService) {}

  /** Customer files a new complaint (CP-EC redressal). Auth: logged-in customer. */
  @Mutation(() => GrievanceEntity, { name: 'fileGrievance' })
  async fileGrievance(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: FileGrievanceInput,
  ): Promise<GrievanceEntity> {
    return this.grievance.fileGrievance(user.userId, input);
  }

  /** The customer's own complaints, newest first. Auth: logged-in customer. */
  @Query(() => [GrievanceEntity], { name: 'myGrievances' })
  async myGrievances(
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<GrievanceEntity[]> {
    return this.grievance.myGrievances(user.userId);
  }

  /** One of the customer's own complaints with its thread. Auth: logged-in customer. */
  @Query(() => GrievanceEntity, { name: 'myGrievance' })
  async myGrievance(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<GrievanceEntity> {
    return this.grievance.myGrievanceDetail(user.userId, id);
  }

  /** Customer replies on their own complaint thread. Auth: logged-in customer. */
  @Mutation(() => GrievanceEntity, { name: 'replyToGrievance' })
  async replyToGrievance(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
    @Args('body', { type: () => String }) body: string,
  ): Promise<GrievanceEntity> {
    return this.grievance.replyToGrievance(user.userId, id, body);
  }
}
