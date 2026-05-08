import { ObjectType, Field, ID, Int } from '@nestjs/graphql';
import { Product } from '@/modules/ecommerce/product/entities/product.entity';

@ObjectType()
export class WishlistItem {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  wishlistId: string;

  @Field(() => ID)
  productId: string;

  @Field(() => ID, { nullable: true })
  variantId?: string | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Product, { nullable: true })
  product?: Product | null;
}

@ObjectType()
export class Wishlist {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  customerId: string;

  @Field(() => String)
  name: string;

  @Field(() => Boolean)
  isPublic: boolean;

  @Field(() => Boolean)
  isDefault: boolean;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => [WishlistItem])
  items: WishlistItem[];

  @Field(() => Int, {
    description: 'Convenience count — same as items.length.',
  })
  itemCount: number;
}
