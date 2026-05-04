import { InputType, Field, ID, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateTaxInput } from './create-tax.input';

@InputType()
export class UpdateTaxInput extends PartialType(CreateTaxInput) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
