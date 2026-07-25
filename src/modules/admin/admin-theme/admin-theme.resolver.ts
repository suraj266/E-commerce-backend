import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';

import { AdminThemeService } from './admin-theme.service';
import { AdminTheme } from './entities/admin-theme.entity';
import { UpdateAdminThemeInput } from './dto/update-admin-theme.input';

import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';

@Resolver(() => AdminTheme)
export class AdminThemeResolver {
  constructor(private readonly service: AdminThemeService) {}

  // ---------------------------------------------------------------------------
  // Public read — fetched server-side by the (admin) layout BEFORE auth runs,
  // so it cannot require a token. Theme isn't sensitive data.
  // ---------------------------------------------------------------------------
  /** Global admin-panel theme tokens (colors/radius/font). Public — the admin layout reads it before auth runs. */
  @Query(() => AdminTheme, { name: 'adminTheme' })
  adminTheme() {
    return this.service.findGlobal();
  }

  // ---------------------------------------------------------------------------
  // Admin mutations
  // ---------------------------------------------------------------------------
  /** Admin updates the singleton admin-panel theme. Auth: theme:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('theme:update')
  @Mutation(() => AdminTheme)
  updateAdminTheme(
    @Args('updateAdminThemeInput') input: UpdateAdminThemeInput,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.service.update(input, user?.userId);
  }

  /** Reset the admin-panel theme back to brand-indigo defaults. Auth: theme:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('theme:update')
  @Mutation(() => AdminTheme)
  resetAdminTheme(@CurrentUser() user?: CurrentUserPayload) {
    return this.service.reset(user?.userId);
  }
}
