import { CreateStoreInput } from './create-store.input';
import { InputType, Field, ID, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

@InputType()
export class UpdateStoreInput extends PartialType(CreateStoreInput) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
