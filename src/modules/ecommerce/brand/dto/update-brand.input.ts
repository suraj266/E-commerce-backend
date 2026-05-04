import { InputType, Field, ID, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateBrandInput } from './create-brand.input';

@InputType()
export class UpdateBrandInput extends PartialType(CreateBrandInput) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
