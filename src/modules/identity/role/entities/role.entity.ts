import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class Role {
  @Field(() => ID)
  id: string;

  @Field()
  name: string

  @Field(() => String, { nullable: true })
  description: string | null

  @Field(() => Boolean, { nullable: true })
  isDefault: boolean | null

  @Field(() => String, { nullable: true })
  createdById: string | null

  @Field(() => String, { nullable: true })
  updatedById: string | null

  @Field()
  createdAt: Date

  @Field()
  updatedAt: Date
}
