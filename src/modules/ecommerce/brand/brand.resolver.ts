import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BrandStatus } from '@prisma/client';
import { BrandService } from './brand.service';
import { Brand } from './entities/brand.entity';
import { CreateBrandInput } from './dto/create-brand.input';
import { UpdateBrandInput } from './dto/update-brand.input';
import { SetBrandStatusInput } from './dto/set-brand-status.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => Brand)
export class BrandResolver {
  constructor(private readonly brandService: BrandService) {}

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  /**
   * Public list — sellers' product create form populates the brand dropdown
   * from this query. Returns ACTIVE brands by default.
   */
  @Query(() => [Brand], { name: 'brands' })
  brands(
    @Args('status', { type: () => BrandStatus, nullable: true })
    status?: BrandStatus,
    @Args('featuredOnly', { type: () => Boolean, nullable: true })
    featuredOnly?: boolean,
  ) {
    return this.brandService.findAll(status ?? BrandStatus.ACTIVE, featuredOnly ?? false);
  }

  @Query(() => Brand, { name: 'publicBrand' })
  publicBrand(@Args('slug', { type: () => String }) slug: string) {
    return this.brandService.findPublic(slug);
  }

  // ---------------------------------------------------------------------------
  // Admin — list with all statuses, includes inactive/deleted-recently filters
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('brand:read')
  @Query(() => [Brand], { name: 'adminBrands' })
  adminBrands(
    @Args('status', { type: () => BrandStatus, nullable: true })
    status?: BrandStatus,
  ) {
    // No status filter ⇒ return both ACTIVE and INACTIVE
    return this.brandService.findAll(status);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('brand:read')
  @Query(() => Brand, { name: 'brand' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.brandService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('brand:create')
  @Mutation(() => Brand)
  createBrand(@Args('createBrandInput') input: CreateBrandInput) {
    return this.brandService.create(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('brand:update')
  @Mutation(() => Brand)
  updateBrand(@Args('updateBrandInput') input: UpdateBrandInput) {
    return this.brandService.update(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('brand:update', 'brand:feature')
  @Mutation(() => Brand)
  setBrandStatus(@Args('setBrandStatusInput') input: SetBrandStatusInput) {
    return this.brandService.setStatus(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('brand:delete')
  @Mutation(() => Brand)
  removeBrand(@Args('id', { type: () => ID }) id: string) {
    return this.brandService.remove(id);
  }
}
