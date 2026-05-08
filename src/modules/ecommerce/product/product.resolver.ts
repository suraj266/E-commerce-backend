import { Resolver, Query, Mutation, Args, ID, Int, Float } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { ProductService } from './product.service';
import { Product, PaginatedProducts } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { CreateProductInput } from './dto/create-product.input';
import { UpdateProductInput } from './dto/update-product.input';
import { SetProductStatusInput } from './dto/set-product-status.input';
import { AddProductImageInput } from './dto/add-product-image.input';
import { UpdateProductImageInput } from './dto/update-product-image.input';
import { ReorderProductImagesInput } from './dto/reorder-product-images.input';
import { ProductSortOrder } from './dto/product-sort.enum';
import {
  ProductVariant,
  VariantAxis,
} from './entities/product-variant.entity';
import { SetVariantAxesInput } from './dto/set-variant-axes.input';
import { GenerateVariantMatrixInput } from './dto/generate-variant-matrix.input';
import { CreateVariantInput } from './dto/create-variant.input';
import { UpdateVariantInput } from './dto/update-variant.input';
import { BulkUpdateVariantsInput } from './dto/bulk-update-variants.input';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import type { CurrentUserPayload } from '@/common/decorators/current-user.decorator';

@Resolver(() => Product)
export class ProductResolver {
  constructor(private readonly productService: ProductService) {}

  // ---------------------------------------------------------------------------
  // Self (seller-bound)
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Query(() => [Product], { name: 'myProducts' })
  myProducts(
    @CurrentUser() user: CurrentUserPayload,
    @Args('storeId', { type: () => ID, nullable: true }) storeId?: string,
    @Args('status', { type: () => ProductStatus, nullable: true })
    status?: ProductStatus,
  ) {
    return this.productService.myProducts(user.userId, storeId, status);
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => Product, { name: 'myProduct' })
  myProduct(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.productService.myProduct(user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Product)
  createMyProduct(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createProductInput') input: CreateProductInput,
  ) {
    return this.productService.createMyProduct(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Product)
  updateMyProduct(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateProductInput') input: UpdateProductInput,
  ) {
    return this.productService.updateMyProduct(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Product)
  setMyProductStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Args('setProductStatusInput') input: SetProductStatusInput,
  ) {
    return this.productService.setMyProductStatus(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Product)
  removeMyProduct(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.productService.removeMyProduct(user.userId, id);
  }

  // ---------------------------------------------------------------------------
  // Image management (seller, scoped to own products)
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductImage)
  addMyProductImage(
    @CurrentUser() user: CurrentUserPayload,
    @Args('addProductImageInput') input: AddProductImageInput,
  ) {
    return this.productService.addImage(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductImage)
  updateMyProductImage(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateProductImageInput') input: UpdateProductImageInput,
  ) {
    return this.productService.updateImage(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductImage)
  removeMyProductImage(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.productService.removeImage(user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Boolean)
  reorderMyProductImages(
    @CurrentUser() user: CurrentUserPayload,
    @Args('reorderProductImagesInput') input: ReorderProductImagesInput,
  ) {
    return this.productService.reorderImages(user.userId, input);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('product:read')
  @Query(() => [Product], { name: 'adminProducts' })
  adminProducts(
    @Args('status', { type: () => ProductStatus, nullable: true })
    status?: ProductStatus,
    @Args('storeId', { type: () => ID, nullable: true }) storeId?: string,
    @Args('brandId', { type: () => ID, nullable: true }) brandId?: string,
    @Args('categoryId', { type: () => ID, nullable: true }) categoryId?: string,
  ) {
    return this.productService.adminFindAll({
      status,
      storeId,
      brandId,
      categoryId,
    });
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('product:read')
  @Query(() => Product, { name: 'adminProduct' })
  adminProduct(@Args('id', { type: () => ID }) id: string) {
    return this.productService.findOneById(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('product:update')
  @Mutation(() => Product)
  adminSetProductStatus(
    @Args('setProductStatusInput') input: SetProductStatusInput,
  ) {
    return this.productService.adminSetStatus(input);
  }

  // ---------------------------------------------------------------------------
  // Public
  // ---------------------------------------------------------------------------

  @Query(() => Product, { name: 'publicProduct' })
  publicProduct(@Args('slug', { type: () => String }) slug: string) {
    return this.productService.findPublic(slug);
  }

  /**
   * Public catalog query — used by store pages, brand pages, tag pages, and
   * category pages. Returns only ACTIVE products from ACTIVE stores.
   */
  @Query(() => [Product], { name: 'publicProducts' })
  publicProducts(
    @Args('storeSlug', { type: () => String, nullable: true }) storeSlug?: string,
    @Args('brandSlug', { type: () => String, nullable: true }) brandSlug?: string,
    @Args('tagSlug', { type: () => String, nullable: true }) tagSlug?: string,
    @Args('categorySlug', { type: () => String, nullable: true }) categorySlug?: string,
    @Args('sort', { type: () => ProductSortOrder, nullable: true })
    sort?: ProductSortOrder,
    @Args('limit', { type: () => Number, nullable: true }) limit?: number,
  ) {
    return this.productService.findPublicProducts({
      storeSlug,
      brandSlug,
      tagSlug,
      categorySlug,
      sort,
      limit,
    });
  }

  /**
   * Paginated catalog with price-range filter — backs /shop. Like
   * `publicProducts` but returns totals for the pager.
   */
  @Query(() => PaginatedProducts, { name: 'paginatedPublicProducts' })
  paginatedPublicProducts(
    @Args('storeSlug', { type: () => String, nullable: true }) storeSlug?: string,
    @Args('brandSlug', { type: () => String, nullable: true }) brandSlug?: string,
    @Args('tagSlug', { type: () => String, nullable: true }) tagSlug?: string,
    @Args('categorySlug', { type: () => String, nullable: true })
    categorySlug?: string,
    @Args('minPrice', { type: () => Float, nullable: true }) minPrice?: number,
    @Args('maxPrice', { type: () => Float, nullable: true }) maxPrice?: number,
    @Args('sort', { type: () => ProductSortOrder, nullable: true })
    sort?: ProductSortOrder,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
  ) {
    return this.productService.findPaginatedPublicProducts({
      storeSlug,
      brandSlug,
      tagSlug,
      categorySlug,
      minPrice,
      maxPrice,
      sort,
      page,
      pageSize,
    });
  }

  // ---------------------------------------------------------------------------
  // Variants — Phase B
  // ---------------------------------------------------------------------------

  @UseGuards(JwtAuthGuard)
  @Query(() => [ProductVariant], { name: 'myProductVariants' })
  myProductVariants(
    @CurrentUser() user: CurrentUserPayload,
    @Args('productId', { type: () => ID }) productId: string,
  ) {
    return this.productService.myProductVariants(user.userId, productId);
  }

  @UseGuards(JwtAuthGuard)
  @Query(() => [VariantAxis], { name: 'myProductVariantAxes' })
  myProductVariantAxes(
    @CurrentUser() user: CurrentUserPayload,
    @Args('productId', { type: () => ID }) productId: string,
  ) {
    return this.productService.myProductVariantAxes(user.userId, productId);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => [VariantAxis])
  setMyProductVariantAxes(
    @CurrentUser() user: CurrentUserPayload,
    @Args('setVariantAxesInput') input: SetVariantAxesInput,
  ) {
    return this.productService.setVariantAxes(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => [ProductVariant])
  generateMyProductVariantMatrix(
    @CurrentUser() user: CurrentUserPayload,
    @Args('generateVariantMatrixInput') input: GenerateVariantMatrixInput,
  ) {
    return this.productService.generateVariantMatrix(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductVariant)
  addMyProductVariant(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createVariantInput') input: CreateVariantInput,
  ) {
    return this.productService.addMyVariant(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductVariant)
  updateMyProductVariant(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateVariantInput') input: UpdateVariantInput,
  ) {
    return this.productService.updateMyVariant(user.userId, input);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductVariant)
  removeMyProductVariant(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    // Service returns { id } since the row is soft-deleted; return shape
    // matches the entity for client cache consistency.
    return this.productService.removeMyVariant(user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Number)
  bulkUpdateMyProductVariants(
    @CurrentUser() user: CurrentUserPayload,
    @Args('bulkUpdateVariantsInput') input: BulkUpdateVariantsInput,
  ) {
    return this.productService.bulkUpdateMyVariants(user.userId, input);
  }
}
