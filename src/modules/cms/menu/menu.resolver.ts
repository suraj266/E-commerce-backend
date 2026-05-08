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

  @Query(() => Menu, { name: 'publicMenu' })
  publicMenu(@Args('location', { type: () => MenuLocation }) location: MenuLocation) {
    return this.menuService.findPublic(location);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:read')
  @Query(() => [Menu], { name: 'adminMenus' })
  adminMenus() {
    return this.menuService.findAllAdmin();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:read')
  @Query(() => Menu, { name: 'adminMenu' })
  adminMenu(
    @Args('location', { type: () => MenuLocation }) location: MenuLocation,
  ) {
    return this.menuService.findOneAdmin(location);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:update', 'menu:create')
  @Mutation(() => Menu)
  upsertMenu(@Args('upsertMenuInput') input: UpsertMenuInput) {
    return this.menuService.upsert(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:update')
  @Mutation(() => Menu)
  setMenuActive(
    @Args('location', { type: () => MenuLocation }) location: MenuLocation,
    @Args('isActive', { type: () => Boolean }) isActive: boolean,
  ) {
    return this.menuService.setActive(location, isActive);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('menu:delete')
  @Mutation(() => Menu)
  removeMenu(
    @Args('location', { type: () => MenuLocation }) location: MenuLocation,
  ) {
    return this.menuService.remove(location);
  }
}
