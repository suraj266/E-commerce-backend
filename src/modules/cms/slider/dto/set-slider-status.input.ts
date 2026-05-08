import { InputType, Field, ID } from '@nestjs/graphql';
import { IsEnum, IsUUID } from 'class-validator';
import { SliderStatus } from '@prisma/client';

@InputType()
export class SetSliderStatusInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => SliderStatus)
  @IsEnum(SliderStatus)
  status: SliderStatus;
}
