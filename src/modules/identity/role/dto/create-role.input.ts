import { InputType, Field } from '@nestjs/graphql';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

@InputType()
export class CreateRoleInput {

  @IsNotEmpty()
  @IsString()
  @Field()
  name: string

  @IsString()
  @IsOptional()
  @Field({ nullable: true })
  description: string

  @IsBoolean()
  @IsOptional()
  @Field({ nullable: true, defaultValue: false })
  isDefault: boolean

  @IsString()
  @IsOptional()
  @Field({ nullable: true })
  createdById: string

  @IsString()
  @IsOptional()
  @Field({ nullable: true })
  updatedById: string

}
