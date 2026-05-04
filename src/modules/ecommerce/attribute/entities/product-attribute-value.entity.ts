import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class ProductAttributeValue {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  attributeId: string;

  @Field(() => String)
  value: string;

  @Field(() => String)
  slug: string;

  @Field(() => Int)
  displayOrder: number;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
