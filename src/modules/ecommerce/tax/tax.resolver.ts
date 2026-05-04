import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { TaxService } from './tax.service';
import { Tax, PaginatedTaxes } from './entities/tax.entity';
import { CreateTaxInput } from './dto/create-tax.input';
import { UpdateTaxInput } from './dto/update-tax.input';

@Resolver(() => Tax)
export class TaxResolver {
  constructor(private readonly taxService: TaxService) {}

  // ---------------------------------------------------------------------------
  // Public — seller product form fetches active taxes for the radio group
  // ---------------------------------------------------------------------------

  @Query(() => [Tax], { name: 'taxes' })
  taxes() {
    return this.taxService.findAllActive();
  }

  // ---------------------------------------------------------------------------
  // Admin — full list (incl. inactive) + paginated
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('tax:read')
  @Query(() => [Tax], { name: 'adminTaxes' })
  adminTaxes() {
    return this.taxService.findAllAdmin();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('tax:read')
  @Query(() => PaginatedTaxes, { name: 'adminTaxesPaginated' })
  adminTaxesPaginated(
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ) {
    return this.taxService.findAllPaginated({ page, pageSize, search });
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('tax:read')
  @Query(() => Tax, { name: 'tax' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.taxService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('tax:create')
  @Mutation(() => Tax)
  createTax(@Args('createTaxInput') input: CreateTaxInput) {
    return this.taxService.create(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('tax:update')
  @Mutation(() => Tax)
  updateTax(@Args('updateTaxInput') input: UpdateTaxInput) {
    return this.taxService.update(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('tax:delete')
  @Mutation(() => Tax)
  removeTax(@Args('id', { type: () => ID }) id: string) {
    return this.taxService.remove(id);
  }
}
