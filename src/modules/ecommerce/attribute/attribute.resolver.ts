import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AttributeType } from '@prisma/client';
import { AttributeService } from './attribute.service';
import { ProductAttribute } from './entities/product-attribute.entity';
import { ProductAttributeValue } from './entities/product-attribute-value.entity';
import { CreateAttributeInput } from './dto/create-attribute.input';
import { UpdateAttributeInput } from './dto/update-attribute.input';
import { CreateAttributeValueInput } from './dto/create-attribute-value.input';
import { UpdateAttributeValueInput } from './dto/update-attribute-value.input';
import { ReorderAttributeValuesInput } from './dto/reorder-attribute-values.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';

@Resolver(() => ProductAttribute)
export class AttributeResolver {
  constructor(private readonly attributeService: AttributeService) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Public list — Phase B variant builder + Sprint 5 filters will use this.
   * Includes values for each attribute. Filterable by type/variant flag.
   */
  @Query(() => [ProductAttribute], { name: 'attributes' })
  attributes(
    @Args('type', { type: () => AttributeType, nullable: true })
    type?: AttributeType,
    @Args('variantOnly', { type: () => Boolean, nullable: true })
    variantOnly?: boolean,
  ) {
    return this.attributeService.findAll(type, variantOnly ?? false);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:read')
  @Query(() => [ProductAttribute], { name: 'adminAttributes' })
  adminAttributes(
    @Args('type', { type: () => AttributeType, nullable: true })
    type?: AttributeType,
  ) {
    return this.attributeService.findAll(type);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:read')
  @Query(() => ProductAttribute, { name: 'attribute' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.attributeService.findOne(id);
  }

  // ---------------------------------------------------------------------------
  // Mutations — attribute itself
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:create')
  @Mutation(() => ProductAttribute)
  createAttribute(
    @Args('createAttributeInput') input: CreateAttributeInput,
  ) {
    return this.attributeService.create(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:update')
  @Mutation(() => ProductAttribute)
  updateAttribute(
    @Args('updateAttributeInput') input: UpdateAttributeInput,
  ) {
    return this.attributeService.update(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:delete')
  @Mutation(() => ProductAttribute)
  removeAttribute(@Args('id', { type: () => ID }) id: string) {
    return this.attributeService.remove(id);
  }

  // ---------------------------------------------------------------------------
  // Mutations — values
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:create')
  @Mutation(() => ProductAttributeValue)
  createAttributeValue(
    @Args('createAttributeValueInput') input: CreateAttributeValueInput,
  ) {
    return this.attributeService.addValue(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:update')
  @Mutation(() => ProductAttributeValue)
  updateAttributeValue(
    @Args('updateAttributeValueInput') input: UpdateAttributeValueInput,
  ) {
    return this.attributeService.updateValue(input);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:delete')
  @Mutation(() => ProductAttributeValue)
  removeAttributeValue(@Args('id', { type: () => ID }) id: string) {
    return this.attributeService.removeValue(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('attribute:update')
  @Mutation(() => Boolean)
  reorderAttributeValues(
    @Args('reorderAttributeValuesInput') input: ReorderAttributeValuesInput,
  ) {
    return this.attributeService.reorderValues(input);
  }
}
