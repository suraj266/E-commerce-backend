import { InputType, Int, Field } from '@nestjs/graphql';

@InputType()
export class CreateSellerInput {
  @Field(() => Int, { description: 'Example field (placeholder)' })
  exampleField: number;
}
