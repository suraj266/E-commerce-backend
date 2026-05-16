import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

/**
 * Lightweight product shape for the header search dropdown. Excludes
 * variants, attributes, descriptions — anything the autocomplete row
 * doesn't render. Keeps the payload small enough to fetch per-keystroke
 * comfortably.
 */
@ObjectType()
export class SearchSuggestion {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  @Field(() => Float)
  price: number;

  @Field(() => String, { nullable: true })
  imageUrl?: string | null;

  @Field(() => String, { nullable: true })
  brandName?: string | null;
}

/**
 * Category match for the header search dropdown. The dropdown renders these
 * above products so customers can jump straight to the catalog view for
 * the matched category instead of scrolling through individual products.
 */
@ObjectType()
export class CategorySuggestion {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  /** Active product count in this category. Drives the "23 products" hint. */
  @Field(() => Int)
  productCount: number;
}

/**
 * Composite payload returned by `searchSuggestions`. Two parallel arrays
 * so the frontend can render them as labeled sections without re-sorting
 * by type on the client.
 */
@ObjectType()
export class SearchSuggestions {
  @Field(() => [CategorySuggestion])
  categories: CategorySuggestion[];

  @Field(() => [SearchSuggestion])
  products: SearchSuggestion[];
}
