import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';

export enum AddressType {
  BILLING = 'billing',
  SHIPPING = 'shipping',
  BOTH = 'both',
}
registerEnumType(AddressType, { name: 'AddressType' });

@ObjectType()
export class Address {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  userId: string;

  @Field(() => AddressType)
  type: AddressType;

  @Field(() => String, { nullable: true })
  label?: string | null;

  @Field(() => String)
  firstName: string;

  @Field(() => String)
  lastName: string;

  @Field(() => String, { nullable: true })
  phone?: string | null;

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

  @Field(() => String, {
    description: 'ISO 3166-1 alpha-2 country code (e.g. "IN", "US").',
  })
  countryCode: string;

  @Field(() => Boolean)
  isDefault: boolean;
}
