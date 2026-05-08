import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { PageStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { PageService } from './page.service';
import { Page, PaginatedPages } from './entities/page.entity';
import { CreatePageInput } from './dto/create-page.input';
import { UpdatePageInput } from './dto/update-page.input';
import { SetPageStatusInput } from './dto/set-page-status.input';

@Resolver(() => Page)
export class PageResolver {
  constructor(private readonly pageService: PageService) {}

  // ---------------------------------------------------------------------------
  // Public — storefront renderer fetches by slug
  // ---------------------------------------------------------------------------

  @Query(() => Page, { name: 'publicPage' })
  publicPage(@Args('slug', { type: () => String }) slug: string) {
    return this.pageService.findPublic(slug);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('page:read')
  @Query(() => [Page], { name: 'adminPages' })
  adminPages(
    @Args('status', { type: () => PageStatus, nullable: true })
    status?: PageStatus,
  ) {
    return this.pageService.findAll(status);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('page:read')
  @Query(() => PaginatedPages, { name: 'adminPagesPaginated' })
  adminPagesPaginated(
    @Args('status', { type: () => PageStatus, nullable: true })
    status?: PageStatus,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ) {
    return this.pageService.findAllPaginated({ status, page, pageSize, search });
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('page:read')
  @Query(() => Page, { name: 'page' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.pageService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('page:create')
  @Mutation(() => Page)
  createPage(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createPageInput') input: CreatePageInput,
  ) {
    return this.pageService.create(input, user.userId);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('page:update')
  @Mutation(() => Page)
  updatePage(@Args('updatePageInput') input: UpdatePageInput) {
    return this.pageService.update(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('page:update')
  @Mutation(() => Page)
  setPageStatus(@Args('setPageStatusInput') input: SetPageStatusInput) {
    return this.pageService.setStatus(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('page:delete')
  @Mutation(() => Page)
  removePage(@Args('id', { type: () => ID }) id: string) {
    return this.pageService.remove(id);
  }
}
