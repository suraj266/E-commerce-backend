import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class ProductImage {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  productId: string;

  @Field(() => String)
  imageUrl: string;

  @Field(() => String, { nullable: true })
  altText?: string | null;

  @Field(() => Int)
  displayOrder: number;

  @Field(() => Boolean)
  isPrimary: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
