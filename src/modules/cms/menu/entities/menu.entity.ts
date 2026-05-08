import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { MenuLocation } from '@prisma/client';

registerEnumType(MenuLocation, { name: 'MenuLocation' });

/**
 * Menu — admin-managed navigation surface (header / footer).
 * Items are JSON-stringified on the wire (free-form tree, no schema lock).
 * Frontend's MenuItem type validates shape on parse.
 */
@ObjectType()
export class Menu {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => MenuLocation)
  location: MenuLocation;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => String, {
    description:
      'JSON-encoded array: [{id, label, url, target?, icon?, visible, children: [...]}]. Frontend parses and renders.',
  })
  items: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;
}
