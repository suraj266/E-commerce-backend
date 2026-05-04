import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class Category {
  @Field(() => ID)
  id: string;

  @Field(() => String, { nullable: true })
  parentId?: string | null;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  imageUrl?: string | null;

  @Field(() => String, { nullable: true })
  iconUrl?: string | null;

  @Field(() => Int)
  displayOrder: number;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  /**
   * Populated only by the `categoryChildren` query — tells the UI whether
   * to render the next cascading dropdown after this option is picked.
   * Other queries leave it null/undefined and clients should ignore it.
   */
  @Field(() => Boolean, { nullable: true })
  hasChildren?: boolean | null;
}

