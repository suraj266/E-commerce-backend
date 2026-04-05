import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class Seller {
  @Field(() => Int, { description: 'Example field (placeholder)' })
  exampleField: number;
}
