import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

/**
 * GraphQL view of a customer for admin tooling. Joins the 1:1 Customer
 * extension with the underlying User row so the admin list shows
 * email/name/status alongside customer-only prefs in a single payload.
 */
@ObjectType()
export class AdminCustomer {
  // ---- Customer extension ----
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  userId: string;

  @Field(() => Boolean)
  marketingOptIn: boolean;

  @Field(() => String)
  preferredCurrency: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  // ---- Flattened User fields (read-only mirror) ----
  @Field(() => String)
  name: string;

  @Field(() => String)
  email: string;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => Date, { nullable: true })
  emailVerifiedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  lastLoginAt?: Date | null;

  @Field(() => Date)
  userCreatedAt: Date;
}

@ObjectType()
export class PaginatedAdminCustomers {
  @Field(() => [AdminCustomer])
  items: AdminCustomer[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
