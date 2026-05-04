import { InputType, Field, ID, Int } from '@nestjs/graphql';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';

@InputType()
export class CreateAttributeValueInput {
  @Field(() => ID)
  @IsUUID()
  attributeId: string;

  @Field(() => String)
  @IsString()
  @Length(1, 100)
  value: string;

  @Field(() => String, {
    nullable: true,
    description: 'Auto-generated from value if blank',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, digits, hyphens',
  })
  slug?: string;

  @Field(() => Int, {
    nullable: true,
    description: 'Appended to end of list when omitted',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
