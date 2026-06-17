import {
  ObjectType,
  Field,
  ID,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { CollectionStatus, CollectionType } from '@prisma/client';

registerEnumType(CollectionType, { name: 'CollectionType' });
registerEnumType(CollectionStatus, { name: 'CollectionStatus' });

/**
 * Product collection. `rule` is exposed as a JSON-encoded string (same
 * convention as Label.rule / Product.specifications) — null for MANUAL.
 */
@ObjectType()
export class Collection {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  bannerUrl?: string | null;

  @Field(() => String, { nullable: true })
  imageUrl?: string | null;

  @Field(() => CollectionType)
  type: CollectionType;

  @Field(() => String, {
    nullable: true,
    description: 'JSON-encoded RuleSet for SMART collections; null for MANUAL.',
  })
  rule?: string | null;

  @Field(() => CollectionStatus)
  status: CollectionStatus;

  @Field(() => Boolean)
  isFeatured: boolean;

  @Field(() => Int)
  displayOrder: number;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  /** MANUAL membership ids — surfaced for the admin product picker. */
  @Field(() => [ID], { nullable: true })
  productIds?: string[];
}
