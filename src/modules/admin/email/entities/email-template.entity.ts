import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';

export enum EmailTemplateCategory {
  SYSTEM = 'SYSTEM',
  AUTH = 'AUTH',
  ORDER = 'ORDER',
  SELLER = 'SELLER',
  ADMIN = 'ADMIN',
  NEWSLETTER = 'NEWSLETTER',
  PARTIAL = 'PARTIAL',
}
registerEnumType(EmailTemplateCategory, { name: 'EmailTemplateCategory' });

@ObjectType()
export class EmailTemplate {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  key: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  description: string;

  @Field(() => EmailTemplateCategory)
  category: EmailTemplateCategory;

  @Field(() => String)
  subject: string;

  @Field(() => String)
  htmlBody: string;

  @Field(() => String, { nullable: true })
  textBody?: string | null;

  @Field(() => [String])
  variables: string[];

  @Field(() => Boolean)
  isEnabled: boolean;

  @Field(() => Boolean)
  isSystem: boolean;

  @Field(() => Date)
  updatedAt: Date;
}
