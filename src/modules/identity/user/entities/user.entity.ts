import { Role } from '@/modules/identity/role/entities/role.entity';
import { ObjectType, Field, ID } from '@nestjs/graphql';

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
