import { Field, InputType } from '@nestjs/graphql';
import { IsString, MaxLength } from 'class-validator';

@InputType()
export class UpdateSiteSettingInput {
  @Field(() => String)
  @IsString()
  @MaxLength(100)
  key: string;

  @Field(() => String)
  @IsString()
  @MaxLength(2000)
  value: string;
}
