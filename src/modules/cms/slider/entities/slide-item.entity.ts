import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class SlideItem {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  sliderId: string;

  @Field(() => String, { nullable: true })
  title?: string | null;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  link?: string | null;

  @Field(() => String, { nullable: true })
  ctaLabel?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Desktop image (>= 1200px). Falls through to tablet/mobile chain.',
  })
  imageUrl?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Tablet image (768-1199px). Falls back to desktop if empty.',
  })
  tabletImageUrl?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Mobile image (<768px). Falls back to tablet → desktop.',
  })
  mobileImageUrl?: string | null;

  @Field(() => Int)
  order: number;

  @Field(() => Boolean)
  isEnabled: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
