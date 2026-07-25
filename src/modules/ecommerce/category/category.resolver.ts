import { Resolver, Query, Mutation, Args, ID, Int } from '@nestjs/graphql';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { PaginatedCategories } from './entities/paginated-categories.entity';
import { CreateCategoryInput } from './dto/create-category.input';
import { UpdateCategoryInput } from './dto/update-category.input';
import { UpdateCategoryTreeInput } from './dto/update-category-tree.input';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import { PermissionsGuard } from '@/common/guards/permissions.guard';

@Resolver(() => Category)
export class CategoryResolver {
  constructor(private readonly categoryService: CategoryService) {}

  /** Creates a category (slug auto-generated + deduped). Auth: category:create. */
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('category:create')
  @Mutation(() => Category)
  createCategory(@Args('createCategoryInput') createCategoryInput: CreateCategoryInput) {
    return this.categoryService.create(createCategoryInput);
  }

  // Categories are publicly readable
  /** Full category list ordered by displayOrder (nav / trees). Public. */
  @Query(() => [Category], { name: 'categories' })
  findAll() {
    return this.categoryService.findAll();
  }

  /**
   * Lightweight query for the shop page filter rail — returns only root
   * categories that contain at least one ACTIVE product (directly or via
   * descendants), each annotated with `productCount`. Public.
   */
  @Query(() => [Category], { name: 'shopFilterCategories' })
  shopFilterCategories() {
    return this.categoryService.findShopFilterCategories();
  }


  /**
   * Children of a given parent (or root categories when parentId omitted).
   * Powers the cascading category picker on the product form. Each result
   * carries `hasChildren` so the UI knows whether to show the next-level
   * dropdown after this one is picked. Public.
   */
  @Query(() => [Category], { name: 'categoryChildren' })
  findChildren(
    @Args('parentId', { type: () => ID, nullable: true })
    parentId?: string | null,
    @Args('search', { type: () => String, nullable: true }) search?: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ) {
    return this.categoryService.findChildren({ parentId, search, limit });
  }

  /**
   * Returns the chain of ancestors for a category, root-first — used to
   * pre-populate the cascading picker when editing an existing product. Public.
   */
  @Query(() => [Category], { name: 'categoryAncestors' })
  findAncestors(@Args('id', { type: () => ID }) id: string) {
    return this.categoryService.findAncestors(id);
  }

  // Paginated + searchable feed for the admin categories table.
  // Public-readable on purpose so it can be cached behind the same CDN
  // policy as `categories`; mutations remain permission-gated below.
  /** Paginated + searchable feed for the admin categories table; public-readable by design. Public. */
  @Query(() => PaginatedCategories, { name: 'adminCategoriesPaginated' })
  findAllPaginated(
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('pageSize', { type: () => Int, nullable: true }) pageSize?: number,
    @Args('search', { type: () => String, nullable: true }) search?: string,
  ) {
    return this.categoryService.findAllPaginated({ page, pageSize, search });
  }

  // Categories are publicly readable
  /** Fetch one category by id. Public. */
  @Query(() => Category, { name: 'category' })
  findOne(@Args('id', { type: () => ID }) id: string) {
    return this.categoryService.findOne(id);
  }

  /**
   * Storefront lookup by slug — backs `/category/[slug]` landing page.
   * Returns the category + its immediate active children (for sub-category
   * chips). Public; only returns active, non-deleted categories.
   */
  @Query(() => Category, { name: 'publicCategoryBySlug' })
  publicCategoryBySlug(@Args('slug', { type: () => String }) slug: string) {
    return this.categoryService.findBySlugPublic(slug);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Edits a category; guards against circular parent references. Auth: category:update. */
  @Permissions('category:update')
  @Mutation(() => Category)
  updateCategory(@Args('updateCategoryInput') updateCategoryInput: UpdateCategoryInput) {
    return this.categoryService.update(updateCategoryInput.id, updateCategoryInput);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Bulk reparent/reorder categories (drag-drop tree save). Auth: category:update. */
  @Permissions('category:update')
  @Mutation(() => Boolean)
  updateCategoryTree(@Args('updateCategoryTreeInput') updateCategoryTreeInput: UpdateCategoryTreeInput) {
    return this.categoryService.updateTree(updateCategoryTreeInput);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  /** Soft-deletes a category. Auth: category:delete. */
  @Permissions('category:delete')
  @Mutation(() => Category)
  removeCategory(@Args('id', { type: () => ID }) id: string) {
    return this.categoryService.remove(id);
  }
}
