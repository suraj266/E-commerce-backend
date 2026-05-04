import { InputType, Field, ID } from '@nestjs/graphql';
import { BrandStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

@InputType()
export class SetBrandStatusInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => BrandStatus, { nullable: true })
  @IsOptional()
  @IsEnum(BrandStatus)
  status?: BrandStatus;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
