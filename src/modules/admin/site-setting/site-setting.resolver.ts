import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { SettingGroup } from '@prisma/client';
import { SiteSettingService } from './site-setting.service';
import { SiteSetting } from './entities/site-setting.entity';
import { UpdateSiteSettingInput } from './dto/update-setting.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => SiteSetting)
export class SiteSettingResolver {
  constructor(private readonly siteSettingService: SiteSettingService) {}

  // ---- Public: storefront needs to read settings (no auth) ----

  /** Public storefront read of site settings, optionally by group (display config). Public. */
  @Query(() => [SiteSetting], {
    name: 'siteSettings',
    description: 'Public — get settings by group. Used by storefront for display config.',
  })
  siteSettings(
    @Args('group', { type: () => SettingGroup, nullable: true })
    group?: SettingGroup,
  ) {
    return this.siteSettingService.findAll(group);
  }

  // ---- Admin: update settings ----

  /** Admin updates a single site-setting value by key (404 if the key is unknown). Auth: setting:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('setting:update')
  @Mutation(() => SiteSetting, {
    name: 'updateSiteSetting',
    description: 'Admin — update a setting value by key.',
  })
  updateSiteSetting(@Args('input') input: UpdateSiteSettingInput) {
    return this.siteSettingService.updateByKey(input.key, input.value);
  }
}
