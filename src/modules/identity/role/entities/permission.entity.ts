import { ObjectType, Field, ID } from '@nestjs/graphql';

/**
 * Permission — one atomic capability, addressed as `module:action`
 * (e.g. `refund:approve`). Rows are seeded in rolePermission.seed.ts; this
 * type exposes the read-only catalog to the admin role-matrix UI (P3-06) and
 * is the target of the assign/revoke mutations on RoleResolver.
 */
@ObjectType()
export class Permission {
  @Field(() => ID)
  id: string;

  @Field()
  module: string;

  @Field()
  action: string;

  /** Convenience slug — `module:action` — matching PermissionsGuard's format. */
  @Field(() => String)
  slug: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
