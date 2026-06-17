import { ObjectType, Field, ID } from '@nestjs/graphql';

/**
 * GraphQL ObjectType for the admin-editable tax-invoice template.
 * Mirrors the EmailTemplate entity. One row, key='tax_invoice'.
 */
@ObjectType()
export class InvoiceTemplate {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  key: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  description: string;

  @Field(() => String)
  htmlBody: string;

  @Field(() => String)
  css: string;

  @Field(() => [String])
  variables: string[];

  @Field(() => Boolean)
  isEnabled: boolean;

  @Field(() => Boolean)
  isSystem: boolean;

  @Field(() => Date)
  updatedAt: Date;
}
