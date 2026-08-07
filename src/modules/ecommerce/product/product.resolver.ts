import { Resolver, Query, Mutation, Args, ID, Int, Float } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { ProductService } from './product.service';
import { Product, PaginatedProducts } from './entities/product.entity';
import { ProductImage } from './entities/product-image.entity';
import { CreateProductInput } from './dto/create-product.input';
import { UpdateProductInput } from './dto/update-product.input';
import { SetProductStatusInput } from './dto/set-product-status.input';
import { AdminCreateProductInput } from './dto/admin-create-product.input';
import { AdminUpdateProductInput } from './dto/admin-update-product.input';
import { AddProductImageInput } from './dto/add-product-image.input';
import { UpdateProductImageInput } from './dto/update-product-image.input';
import { ReorderProductImagesInput } from './dto/reorder-product-images.input';
import { ProductSortOrder } from './dto/product-sort.enum';
import {
  ProductVariant,
  VariantAxis,
} from './entities/product-variant.entity';
import { SearchSuggestions } from './entities/search-suggestion.entity';
import { DeliveryEstimate } from './entities/delivery-estimate.entity';
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

  /** Seller's own product list; filter by store/status. Auth: logged-in seller. */
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

  /** Fetch one of the seller's own products by id. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Query(() => Product, { name: 'myProduct' })
  myProduct(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.productService.myProduct(user.userId, id);
  }

  /** Seller creates a product in their own store; starts DRAFT, needs a VERIFIED seller. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Product)
  createMyProduct(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createProductInput') input: CreateProductInput,
  ) {
    return this.productService.createMyProduct(user.userId, input);
  }

  /** Seller edits their own product; price/sku land on the default variant. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Product)
  updateMyProduct(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateProductInput') input: UpdateProductInput,
  ) {
    return this.productService.updateMyProduct(user.userId, input);
  }

  /** Seller sets own product status; ACTIVE enforces GST publish gates, ARCHIVE is admin-only. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Product)
  setMyProductStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Args('setProductStatusInput') input: SetProductStatusInput,
  ) {
    return this.productService.setMyProductStatus(user.userId, input);
  }

  /** Seller soft-deletes their product; only DRAFT or ARCHIVED can be deleted. Auth: logged-in seller. */
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

  /** Seller adds an image to their product; first image (or isPrimary) becomes primary. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductImage)
  addMyProductImage(
    @CurrentUser() user: CurrentUserPayload,
    @Args('addProductImageInput') input: AddProductImageInput,
  ) {
    return this.productService.addImage(user.userId, input);
  }

  /** Seller edits a product image (alt text / order / primary flag). Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductImage)
  updateMyProductImage(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateProductImageInput') input: UpdateProductImageInput,
  ) {
    return this.productService.updateImage(user.userId, input);
  }

  /** Seller hard-deletes one of their product images. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductImage)
  removeMyProductImage(
    @CurrentUser() user: CurrentUserPayload,
    @Args('id', { type: () => ID }) id: string,
  ) {
    return this.productService.removeImage(user.userId, id);
  }

  /** Seller reorders their product's images by id list. Auth: logged-in seller. */
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

  /** Admin catalog list, filter by status/store/brand/category. Auth: product:read. */
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

  /** Admin fetches any product by id (all statuses). Auth: product:read. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('product:read')
  @Query(() => Product, { name: 'adminProduct' })
  adminProduct(@Args('id', { type: () => ID }) id: string) {
    return this.productService.findOneById(id);
  }

  /** Admin creates a product under any store; can publish immediately via status. Auth: product:create. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('product:create')
  @Mutation(() => Product)
  adminCreateProduct(@Args('input') input: AdminCreateProductInput) {
    return this.productService.adminCreate(input);
  }

  /** Admin edits any product (bypasses seller-ownership); may also change status. Auth: product:update. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('product:update')
  @Mutation(() => Product)
  adminUpdateProduct(@Args('input') input: AdminUpdateProductInput) {
    return this.productService.adminUpdate(input);
  }

  /** Admin sets any product's status; records reason + timestamp in metadata. Auth: product:update. */
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

  /** Storefront PDP by slug; only ACTIVE products in ACTIVE stores, enriched with per-variant stock. Public. */
  @Query(() => Product, { name: 'publicProduct' })
  publicProduct(@Args('slug', { type: () => String }) slug: string) {
    return this.productService.findPublic(slug);
  }

  /**
   * Public catalog query — used by store pages, brand pages, tag pages, and
   * category pages. Returns only ACTIVE products from ACTIVE stores. Public.
   */
  @Query(() => [Product], { name: 'publicProducts' })
  publicProducts(
    @Args('storeSlug', { type: () => String, nullable: true }) storeSlug?: string,
    @Args('brandSlug', { type: () => String, nullable: true }) brandSlug?: string,
    @Args('tagSlug', { type: () => String, nullable: true }) tagSlug?: string,
    @Args('categorySlug', { type: () => String, nullable: true }) categorySlug?: string,
    @Args('collectionSlug', { type: () => String, nullable: true })
    collectionSlug?: string,
    @Args('sort', { type: () => ProductSortOrder, nullable: true })
    sort?: ProductSortOrder,
    @Args('limit', { type: () => Number, nullable: true }) limit?: number,
  ) {
    return this.productService.findPublicProducts({
      storeSlug,
      brandSlug,
      tagSlug,
      categorySlug,
      collectionSlug,
      sort,
      limit,
    });
  }

  /**
   * Paginated catalog with price-range filter — backs /shop. Like
   * `publicProducts` but returns totals for the pager. Public.
   */
  @Query(() => PaginatedProducts, { name: 'paginatedPublicProducts' })
  paginatedPublicProducts(
    @Args('storeSlug', { type: () => String, nullable: true }) storeSlug?: string,
    @Args('brandSlug', { type: () => String, nullable: true }) brandSlug?: string,
    @Args('tagSlug', { type: () => String, nullable: true }) tagSlug?: string,
    @Args('categorySlug', { type: () => String, nullable: true })
    categorySlug?: string,
    @Args('collectionSlug', { type: () => String, nullable: true })
    collectionSlug?: string,
    @Args('minPrice', { type: () => Float, nullable: true }) minPrice?: number,
    @Args('maxPrice', { type: () => Float, nullable: true }) maxPrice?: number,
    @Args('sort', { type: () => ProductSortOrder, nullable: true })
    sort?: ProductSortOrder,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ) {
    return this.productService.findPaginatedPublicProducts({
      storeSlug,
      brandSlug,
      tagSlug,
      categorySlug,
      collectionSlug,
      minPrice,
      maxPrice,
      sort,
      page,
      pageSize,
      search,
    });
  }

  /**
   * Header autocomplete. Returns up to `limit` light-weight product rows
   * matching the term. The full /search page uses searchProducts. Public.
   */
  @Query(() => SearchSuggestions, { name: 'searchSuggestions' })
  searchSuggestions(
    @Args('q', { type: () => String }) q: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ) {
    return this.productService.searchSuggestions({ q, limit });
  }

  /**
   * Full-text product search backing /search — Postgres `websearch_to_tsquery`
   * ranking over the product's weighted search vector + brand name, with the
   * shop facets (category descendants / price / brand) and pagination. Sort
   * defaults to relevance. Public.
   */
  @Query(() => PaginatedProducts, { name: 'searchProducts' })
  searchProducts(
    @Args('query', { type: () => String }) query: string,
    @Args('categorySlug', { type: () => String, nullable: true })
    categorySlug?: string,
    @Args('brandSlug', { type: () => String, nullable: true }) brandSlug?: string,
    @Args('minPrice', { type: () => Float, nullable: true }) minPrice?: number,
    @Args('maxPrice', { type: () => Float, nullable: true }) maxPrice?: number,
    @Args('sort', { type: () => ProductSortOrder, nullable: true })
    sort?: ProductSortOrder,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
  ) {
    return this.productService.searchProducts({
      query,
      categorySlug,
      brandSlug,
      minPrice,
      maxPrice,
      sort,
      page,
      pageSize,
    });
  }

  /**
   * Storefront delivery estimate: product/variant → pincode. Reuses the live
   * courier serviceability (read-only) and degrades to the in-house shipping
   * config. Pass exactly one of productId / variantId. Public.
   */
  @Query(() => DeliveryEstimate, { name: 'deliveryEstimate' })
  deliveryEstimate(
    @Args('pincode', { type: () => String }) pincode: string,
    @Args('productId', { type: () => ID, nullable: true }) productId?: string,
    @Args('variantId', { type: () => ID, nullable: true }) variantId?: string,
  ) {
    return this.productService.deliveryEstimate({
      pincode,
      productId,
      variantId,
    });
  }

  // ---------------------------------------------------------------------------
  // Variants — Phase B
  // ---------------------------------------------------------------------------

  /** Lists all variants of a product the seller owns. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Query(() => [ProductVariant], { name: 'myProductVariants' })
  myProductVariants(
    @CurrentUser() user: CurrentUserPayload,
    @Args('productId', { type: () => ID }) productId: string,
  ) {
    return this.productService.myProductVariants(user.userId, productId);
  }

  /** Variant axes (attribute + values) configured for the seller's product. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Query(() => [VariantAxis], { name: 'myProductVariantAxes' })
  myProductVariantAxes(
    @CurrentUser() user: CurrentUserPayload,
    @Args('productId', { type: () => ID }) productId: string,
  ) {
    return this.productService.myProductVariantAxes(user.userId, productId);
  }

  /** Sets variant axes for a VARIABLE product; blocked if variants already exist. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => [VariantAxis])
  setMyProductVariantAxes(
    @CurrentUser() user: CurrentUserPayload,
    @Args('setVariantAxesInput') input: SetVariantAxesInput,
  ) {
    return this.productService.setVariantAxes(user.userId, input);
  }

  /** Generates the variant matrix (cartesian of axes); idempotent, capped at 100 combos. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => [ProductVariant])
  generateMyProductVariantMatrix(
    @CurrentUser() user: CurrentUserPayload,
    @Args('generateVariantMatrixInput') input: GenerateVariantMatrixInput,
  ) {
    return this.productService.generateVariantMatrix(user.userId, input);
  }

  /** Seller adds one variant (one value per axis, no duplicate combo) to a VARIABLE product. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductVariant)
  addMyProductVariant(
    @CurrentUser() user: CurrentUserPayload,
    @Args('createVariantInput') input: CreateVariantInput,
  ) {
    return this.productService.addMyVariant(user.userId, input);
  }

  /** Seller edits one of their variants; re-syncs the product's cached base price. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => ProductVariant)
  updateMyProductVariant(
    @CurrentUser() user: CurrentUserPayload,
    @Args('updateVariantInput') input: UpdateVariantInput,
  ) {
    return this.productService.updateMyVariant(user.userId, input);
  }

  /** Seller soft-deletes a variant (drops its attribute rows). Auth: logged-in seller. */
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

  /** Bulk-updates price/compareAtPrice/status across a product's variants; returns count. Auth: logged-in seller. */
  @UseGuards(JwtAuthGuard)
  @Mutation(() => Number)
  bulkUpdateMyProductVariants(
    @CurrentUser() user: CurrentUserPayload,
    @Args('bulkUpdateVariantsInput') input: BulkUpdateVariantsInput,
  ) {
    return this.productService.bulkUpdateMyVariants(user.userId, input);
  }
}
