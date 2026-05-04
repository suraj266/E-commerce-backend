import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { BrandStatus } from '@prisma/client';

registerEnumType(BrandStatus, { name: 'BrandStatus' });

@ObjectType()
export class Brand {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  slug: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  logoUrl?: string | null;

  @Field(() => String, { nullable: true })
  bannerUrl?: string | null;

  @Field(() => String, { nullable: true })
  websiteUrl?: string | null;

  @Field(() => String, { nullable: true, description: 'ISO 3166-1 alpha-2 (e.g. IN, US)' })
  countryCode?: string | null;

  @Field(() => Int, { nullable: true })
  foundedYear?: number | null;

  @Field(() => BrandStatus)
  status: BrandStatus;

  @Field(() => Boolean)
  isFeatured: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
