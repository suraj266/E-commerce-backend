import { InputType, Field } from '@nestjs/graphql';
import {
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

@InputType()
export class CreateSliderInput {
  @Field(() => String)
  @IsString()
  @Length(1, 80)
  name: string;

  @Field(() => String, {
    nullable: true,
    description: 'Stable identifier. Auto-slugified from name if omitted.',
  })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'Key must be lowercase letters/digits separated by single hyphens',
  })
  key?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @Field(() => String, {
    nullable: true,
    description: 'JSON-encoded config object.',
  })
  @IsOptional()
  @IsString()
  config?: string;
}
