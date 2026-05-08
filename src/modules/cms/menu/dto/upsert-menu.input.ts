import { InputType, Field } from '@nestjs/graphql';
import { MenuLocation } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';

/**
 * Single mutation handles create + update because each location has at
 * most one menu. The service routes by `location`, creating a row if
 * none exists or updating the existing one.
 */
@InputType()
export class UpsertMenuInput {
  @Field(() => MenuLocation)
  @IsEnum(MenuLocation)
  location: MenuLocation;

  @Field(() => String)
  @IsString()
  @Length(1, 80)
  name: string;

  @Field(() => Boolean, { nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => String, {
    description: 'JSON-encoded array of MenuItem nodes (tree).',
  })
  @IsString()
  items: string;
}
