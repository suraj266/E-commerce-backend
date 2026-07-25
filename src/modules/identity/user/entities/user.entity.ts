import { Role } from '@/modules/identity/role/entities/role.entity';
import { ObjectType, Field, ID, Int } from '@nestjs/graphql';

@ObjectType()
export class User {
  @Field(() => ID)
  id?: string;

  @Field()
  email?: string;

  @Field(() => Date, { nullable: true })
  emailVerifiedAt?: Date | null;

  @Field(() => String, { nullable: true })
  phone?: string | null;

  @Field(() => Date, { nullable: true })
  phoneVerifiedAt?: Date | null;

  @Field(() => String, { nullable: true })
  name?: string | null;

  @Field(() => String, { nullable: true })
  roleId?: string | null;

  @Field(() => Role, { nullable: true })
  role?: Role | null;

  @Field(() => String, { nullable: true })
  avatarUrl?: string | null;

  @Field(() => Date, { nullable: true })
  dateOfBirth?: Date | null;

  @Field(() => String, { nullable: true })
  gender?: string | null;

  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => Date, { nullable: true })
  lastLoginAt?: Date | null;

  @Field(() => Date)
  createdAt?: Date;

  @Field(() => Date)
  updatedAt?: Date;
}

/** Server-paginated admin user list (Phase 3 Wave 4). */
@ObjectType()
export class PaginatedUsers {
  @Field(() => [User])
  items: User[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
