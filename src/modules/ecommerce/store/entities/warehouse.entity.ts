import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class Warehouse {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  storeId: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  code: string;

  @Field(() => String)
  addressLine1: string;

  @Field(() => String, { nullable: true })
  addressLine2?: string | null;

  @Field(() => String)
  city: string;

  @Field(() => String)
  state: string;

  @Field(() => String)
  postalCode: string;

  @Field(() => String)
  countryCode: string;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => Boolean)
  isDefault: boolean;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
