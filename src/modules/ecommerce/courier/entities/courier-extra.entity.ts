import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

/** A pickup location fetched from the seller's courier account. */
@ObjectType()
export class CourierPickupLocation {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  nickname: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  address: string;

  @Field(() => String)
  city: string;

  @Field(() => String)
  state: string;

  @Field(() => String)
  pincode: string;

  @Field(() => String)
  phone: string;
}

/** A single available courier from live serviceability (ship-time picker). */
@ObjectType()
export class CourierOption {
  @Field(() => String)
  courierId: string;

  @Field(() => String)
  courierName: string;

  @Field(() => Float)
  rate: number;

  @Field(() => Int, { nullable: true })
  estimatedDays?: number | null;

  @Field(() => Boolean)
  codAvailable: boolean;

  @Field(() => Boolean)
  recommended: boolean;
}

/** Courier options for an order + the courier the customer picked at checkout. */
@ObjectType()
export class CourierOptionsResult {
  @Field(() => [CourierOption])
  couriers: CourierOption[];

  @Field(() => String, { nullable: true })
  selectedCourierId?: string | null;

  @Field(() => String, { nullable: true })
  selectedCourierName?: string | null;
}
