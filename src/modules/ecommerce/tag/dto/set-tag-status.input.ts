import { InputType, Field, ID } from '@nestjs/graphql';
import { TagStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

@InputType()
export class SetTagStatusInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => TagStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TagStatus)
  status?: TagStatus;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
