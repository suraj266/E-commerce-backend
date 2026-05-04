import { InputType, Field, Float, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

@InputType()
export class CreateTaxInput {
  @Field(() => String)
  @IsString()
  @Length(1, 50)
  name: string;

  @Field(() => Float)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
