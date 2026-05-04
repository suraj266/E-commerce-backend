import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { TagStatus } from '@prisma/client';

registerEnumType(TagStatus, { name: 'TagStatus' });

@ObjectType()
export class Tag {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => TagStatus)
  status: TagStatus;

  @Field(() => Boolean)
  isFeatured: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
