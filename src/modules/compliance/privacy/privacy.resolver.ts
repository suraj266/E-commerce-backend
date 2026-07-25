/**
 * PrivacyResolver — customer-facing DPDP data-subject rights.
 *
 * Every operation is scoped to the signed-in principal via `@CurrentUser` — a
 * customer can only export / erase / consent for THEIR OWN account. There is no
 * admin surface here (an admin acting on behalf of a principal would be a
 * separate, audited flow).
 */

import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { PrivacyService } from './privacy.service';
import {
  AccountDeletionRequestEntity,
  DataExportRequestEntity,
  MarketingConsentState,
} from './entities/privacy.entities';
import { UpdateMarketingConsentInput } from './dto/update-marketing-consent.input';

@Resolver()
@UseGuards(JwtAuthGuard)
export class PrivacyResolver {
  constructor(private readonly privacy: PrivacyService) {}

  // --- Data export -----------------------------------------------------------

  /** Request a DPDP export of your own data; built async, then emailed as a signed expiring link. Auth: logged-in user (self). */
  @Mutation(() => DataExportRequestEntity, { name: 'requestMyDataExport' })
  requestMyDataExport(@CurrentUser() user: CurrentUserPayload) {
    return this.privacy.requestExport(user.userId);
  }

  /** List your own data-export requests (newest first). Auth: logged-in user (self). */
  @Query(() => [DataExportRequestEntity], { name: 'myDataExports' })
  myDataExports(@CurrentUser() user: CurrentUserPayload) {
    return this.privacy.myExports(user.userId);
  }

  // --- Account deletion (erasure) --------------------------------------------

  /** Request erasure of your own account; opens a grace-period countdown before the irreversible scrub. Auth: logged-in user (self). */
  @Mutation(() => AccountDeletionRequestEntity, {
    name: 'requestMyAccountDeletion',
  })
  requestMyAccountDeletion(@CurrentUser() user: CurrentUserPayload) {
    return this.privacy.requestDeletion(user.userId);
  }

  /** Cancel your account-deletion while still in the grace window (an executed erasure can't be undone). Auth: logged-in user (self). */
  @Mutation(() => AccountDeletionRequestEntity, {
    name: 'cancelMyAccountDeletion',
    nullable: true,
  })
  cancelMyAccountDeletion(@CurrentUser() user: CurrentUserPayload) {
    return this.privacy.cancelDeletion(user.userId);
  }

  /** Your most recent account-deletion request, if any. Auth: logged-in user (self). */
  @Query(() => AccountDeletionRequestEntity, {
    name: 'myAccountDeletion',
    nullable: true,
  })
  myAccountDeletion(@CurrentUser() user: CurrentUserPayload) {
    return this.privacy.myDeletion(user.userId);
  }

  // --- Marketing consent -----------------------------------------------------

  /** Your current marketing-email consent state (fail-closed: no record means false). Auth: logged-in user (self). */
  @Query(() => MarketingConsentState, { name: 'myMarketingConsent' })
  myMarketingConsent(@CurrentUser() user: CurrentUserPayload) {
    return this.privacy.getMarketingConsent(user.userId);
  }

  /** Toggle your marketing-email consent; appends an immutable consent record (no update-in-place). Auth: logged-in user (self). */
  @Mutation(() => MarketingConsentState, { name: 'updateMyMarketingConsent' })
  updateMyMarketingConsent(
    @CurrentUser() user: CurrentUserPayload,
    @Args('input') input: UpdateMarketingConsentInput,
  ) {
    return this.privacy.updateMarketingConsent(user.userId, input.granted);
  }
}
