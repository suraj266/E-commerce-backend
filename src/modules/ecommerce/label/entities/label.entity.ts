import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { LabelType } from '@prisma/client';

registerEnumType(LabelType, { name: 'LabelType' });

/**
 * Lightweight badge shape attached to a Product (manual + derived auto labels,
 * merged and sorted by priority). The card renders the top 1-2 of these.
 */
@ObjectType()
export class ProductBadge {
  @Field(() => String)
  key: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  color: string;

  @Field(() => String, { nullable: true })
  textColor?: string | null;

  @Field(() => String, { nullable: true })
  icon?: string | null;

  @Field(() => Int)
  priority: number;
}

/**
 * Product label (badge). `rule` is exposed as a JSON-encoded string (same
 * convention as Product.specifications) — null for MANUAL labels.
 */
@ObjectType()
export class Label {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  key: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  color: string;

  @Field(() => String, { nullable: true })
  textColor?: string | null;

  @Field(() => String, { nullable: true })
  icon?: string | null;

  @Field(() => LabelType)
  type: LabelType;

  @Field(() => String, {
    nullable: true,
    description: 'JSON-encoded RuleSet for AUTO labels; null for MANUAL.',
  })
  rule?: string | null;

  @Field(() => Int)
  priority: number;

  @Field(() => Boolean)
  isEnabled: boolean;

  @Field(() => Boolean)
  isSystem: boolean;

  @Field(() => Int)
  displayOrder: number;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
