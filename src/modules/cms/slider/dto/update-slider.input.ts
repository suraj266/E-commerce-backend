import { InputType, Field, ID, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateSliderInput } from './create-slider.input';

@InputType()
export class UpdateSliderInput extends PartialType(CreateSliderInput) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
