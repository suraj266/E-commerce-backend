import { InputType, Field, ID } from '@nestjs/graphql';
import { StoreStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';

@InputType()
export class SetStoreStatusInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => StoreStatus)
  @IsEnum(StoreStatus)
  status: StoreStatus;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
