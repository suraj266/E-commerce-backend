import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class AdminTheme {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  primaryLight: string;

  @Field(() => String)
  primaryDark: string;

  @Field(() => String)
  accentLight: string;

  @Field(() => String)
  accentDark: string;

  @Field(() => String)
  sidebarLight: string;

  @Field(() => String)
  sidebarDark: string;

  @Field(() => String)
  destructiveLight: string;

  @Field(() => String)
  destructiveDark: string;

  @Field(() => String)
  radius: string;

  @Field(() => String, { nullable: true })
  fontFamily?: string | null;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => String, { nullable: true })
  updatedById?: string | null;
}
