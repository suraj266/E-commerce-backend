import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

/**
 * Tax — admin-managed catalog row. Sellers pick one of these per product
 * via a radio group on the product form. Single `rate` column is intentional
 * (Indian GST is a flat percentage; the IGST/CGST+SGST split is computed at
 * order time by halving the rate for intra-state sales).
 */
@ObjectType()
export class Tax {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => Float, {
    description: 'Percentage value (0-100), e.g. 18.00 for 18% GST.',
  })
  rate: number;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => Int)
  displayOrder: number;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}

@ObjectType()
export class PaginatedTaxes {
  @Field(() => [Tax])
  items: Tax[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
