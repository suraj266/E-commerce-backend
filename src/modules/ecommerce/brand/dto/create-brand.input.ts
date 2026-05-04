import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

@InputType()
export class CreateBrandInput {
  @Field(() => String)
  @IsString()
  @Length(2, 100)
  name: string;

  @Field(() => String, {
    nullable: true,
    description: 'Auto-generated from name if blank',
  })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  slug?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  bannerUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUrl({}, { message: 'websiteUrl must be a valid URL' })
  websiteUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1700)
  @Max(new Date().getFullYear())
  foundedYear?: number;

  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
