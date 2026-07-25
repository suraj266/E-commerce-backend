import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { MenuLocation } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { MenuService } from './menu.service';
import { Menu } from './entities/menu.entity';
import { UpsertMenuInput } from './dto/upsert-menu.input';

@Resolver(() => Menu)
export class MenuResolver {
  constructor(private readonly menuService: MenuService) {}

  // ---------------------------------------------------------------------------
  // Public — storefront header/footer fetch by location
  // ---------------------------------------------------------------------------

  /** Public storefront menu tree by location (header/footer); only active, non-deleted menus. Public. */
  @Query(() => Menu, { name: 'publicMenu' })
  publicMenu(@Args('location', { type: () => MenuLocation }) location: MenuLocation) {
    return this.menuService.findPublic(location);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  /** Admin list of all menus across locations. Auth: menu:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:read')
  @Query(() => [Menu], { name: 'adminMenus' })
  adminMenus() {
    return this.menuService.findAllAdmin();
  }

  /** Admin fetch of one menu by location, including inactive. Auth: menu:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:read')
  @Query(() => Menu, { name: 'adminMenu' })
  adminMenu(
    @Args('location', { type: () => MenuLocation }) location: MenuLocation,
  ) {
    return this.menuService.findOneAdmin(location);
  }

  /** Create-or-replace a location's menu (one per location); revives a soft-deleted one. Auth: menu:update + menu:create. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:update', 'menu:create')
  @Mutation(() => Menu)
  upsertMenu(@Args('upsertMenuInput') input: UpsertMenuInput) {
    return this.menuService.upsert(input);
  }

  /** Toggle a menu's active/published flag by location. Auth: menu:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:update')
  @Mutation(() => Menu)
  setMenuActive(
    @Args('location', { type: () => MenuLocation }) location: MenuLocation,
    @Args('isActive', { type: () => Boolean }) isActive: boolean,
  ) {
    return this.menuService.setActive(location, isActive);
  }

  /** Soft-delete a location's menu (also deactivates it). Auth: menu:delete. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:delete')
  @Mutation(() => Menu)
  removeMenu(
    @Args('location', { type: () => MenuLocation }) location: MenuLocation,
  ) {
    return this.menuService.remove(location);
  }
}
