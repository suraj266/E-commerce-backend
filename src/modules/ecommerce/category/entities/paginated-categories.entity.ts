import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Category } from './category.entity';

/**
 * Paginated response for the admin category table. Kept separate from the
 * public/dropdown `categories` query (which still returns the full list)
 * because the admin browser is the only consumer that needs paging — every
 * other consumer (product form dropdowns, public storefront filters) wants
 * the full tree in one shot for client-side rendering.
 */
@ObjectType()
export class PaginatedCategories {
  @Field(() => [Category])
  items: Category[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
