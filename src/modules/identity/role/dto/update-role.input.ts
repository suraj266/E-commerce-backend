import { IsNotEmpty } from 'class-validator';
import { CreateRoleInput } from './create-role.input';
import { InputType, Field, PartialType, ID } from '@nestjs/graphql';

@InputType()
export class UpdateRoleInput extends PartialType(CreateRoleInput) {
  @IsNotEmpty()
  @Field(() => ID)
  id: string;
}
