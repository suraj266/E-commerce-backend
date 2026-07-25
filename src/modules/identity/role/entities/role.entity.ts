import { ObjectType, Field, ID } from '@nestjs/graphql';
import { Permission } from './permission.entity';

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

  /**
   * The permissions currently granted to this role. Populated by
   * RoleService.findAll/findOne (which include the RolePermission join); null
   * on mutation payloads that don't re-hydrate the join. Drives the admin
   * role-matrix UI (P3-06).
   */
  @Field(() => [Permission], { nullable: true })
  permissions?: Permission[] | null
}
