import { InputType, Field } from '@nestjs/graphql';
import { AttributeType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

@InputType()
export class CreateAttributeInput {
  @Field(() => String)
  @IsString()
  @Length(2, 60)
  name: string;

  @Field(() => String, {
    nullable: true,
    description: 'Auto-generated from name if blank',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, digits, hyphens',
  })
  slug?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @Field(() => AttributeType, { defaultValue: AttributeType.SELECT })
  @IsOptional()
  @IsEnum(AttributeType)
  type?: AttributeType;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isVariantAttribute?: boolean;
}
