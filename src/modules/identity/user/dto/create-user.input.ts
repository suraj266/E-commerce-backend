import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

@InputType()
export class CreateUserInput {
  @IsEmail()
  @IsNotEmpty()
  @Field()
  email: string;

  @IsNotEmpty()
  @MinLength(8)
  @Field()
  password: string;

  @IsNotEmpty()
  @Field()
  phone: string;

  @IsNotEmpty()
  @Field()
  name: string;

  @IsOptional()
  @Field({ nullable: true })
  dateOfBirth?: Date;

  @IsOptional()
  @Field({ nullable: true })
  gender?: string;

  @IsOptional()
  @Field({ nullable: true, defaultValue: "inactive" })
  status?: string;

  @IsOptional()
  @Field({ nullable: true })
  avatarUrl?: string;

  @IsOptional()
  @Field({ nullable: true })
  emailVerifiedAt?: Date;

  @IsOptional()
  @Field({ nullable: true })
  lastLoginAt?: Date;

  @IsOptional()
  @Field({ nullable: true })
  phoneVerifiedAt?: Date;

  @IsNotEmpty()
  @IsString()
  @Field()
  roleId: string
}
