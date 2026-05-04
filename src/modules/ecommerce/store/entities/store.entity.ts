import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { StoreStatus } from '@prisma/client';
import { Warehouse } from './warehouse.entity';

registerEnumType(StoreStatus, { name: 'StoreStatus' });

@ObjectType()
export class Store {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  sellerId: string;

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
  customDomain?: string | null;

  @Field(() => String, { nullable: true })
  subdomain?: string | null;

  @Field(() => String)
  currencyCode: string;

  @Field(() => String)
  timezone: string;

  @Field(() => String)
  locale: string;

  @Field(() => String, { nullable: true })
  supportEmail?: string | null;

  @Field(() => String, { nullable: true })
  supportPhone?: string | null;

  @Field(() => StoreStatus)
  status: StoreStatus;

  @Field(() => Boolean)
  isFeatured: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  @Field(() => [Warehouse], { nullable: true })
  warehouses?: Warehouse[];
}
