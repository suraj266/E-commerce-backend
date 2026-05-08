import { InputType, Field, ID } from '@nestjs/graphql';
import { IsEnum, IsUUID } from 'class-validator';
import { PageStatus } from '@prisma/client';

@InputType()
export class SetPageStatusInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field(() => PageStatus)
  @IsEnum(PageStatus)
  status: PageStatus;
}
