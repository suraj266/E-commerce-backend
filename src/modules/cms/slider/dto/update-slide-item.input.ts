import { InputType, Field, ID, OmitType, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { AddSlideItemInput } from './add-slide-item.input';

/** Partial — sliderId can't change after create. */
@InputType()
export class UpdateSlideItemInput extends PartialType(
  OmitType(AddSlideItemInput, ['sliderId'] as const),
) {
  @Field(() => ID)
  @IsUUID()
  id: string;
}
