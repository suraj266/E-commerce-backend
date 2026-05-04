import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { AttributeType } from '@prisma/client';
import { ProductAttributeValue } from './product-attribute-value.entity';

registerEnumType(AttributeType, { name: 'AttributeType' });

@ObjectType()
export class ProductAttribute {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => AttributeType)
  type: AttributeType;

  @Field(() => Boolean, {
    description:
      'When true, this attribute is used to differentiate variants (Phase B).',
  })
  isVariantAttribute: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  @Field(() => [ProductAttributeValue], { nullable: true })
  values?: ProductAttributeValue[];
}
