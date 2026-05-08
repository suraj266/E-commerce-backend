import {
  ObjectType,
  Field,
  ID,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { PageStatus } from '@prisma/client';

registerEnumType(PageStatus, { name: 'PageStatus' });

/**
 * Page — admin-composable CMS page rendered at /[slug] on the public site.
 * `blocks` is a JSON-stringified array of `{ id, type, props, visible }`
 * entries. Frontend's BLOCK_REGISTRY maps `type` → React component.
 *
 * The shape isn't typed at the GraphQL layer (it's a free-form `String`)
 * because blocks evolve independently and need lazy migration. Frontend
 * parses + validates per-block via the registry.
 */
@ObjectType()
export class Page {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  slug: string;

  @Field(() => String)
  title: string;

  @Field(() => String, { nullable: true })
  metaTitle?: string | null;

  @Field(() => String, { nullable: true })
  metaDesc?: string | null;

  @Field(() => PageStatus)
  status: PageStatus;

  @Field(() => String, {
    description:
      'JSON-encoded array: [{id, type, props, visible}]. Frontend parses + renders via BLOCK_REGISTRY.',
  })
  blocks: string;

  @Field(() => Boolean)
  isSystem: boolean;

  @Field(() => Date, { nullable: true })
  publishedAt?: Date | null;

  @Field(() => ID, { nullable: true })
  createdById?: string | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}

@ObjectType()
export class PaginatedPages {
  @Field(() => [Page])
  items: Page[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
