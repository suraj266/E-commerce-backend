import {
  ObjectType,
  Field,
  ID,
  registerEnumType,
} from '@nestjs/graphql';
import { SettingGroup, SettingValueType } from '@prisma/client';

registerEnumType(SettingGroup, { name: 'SettingGroup' });
registerEnumType(SettingValueType, { name: 'SettingValueType' });

@ObjectType()
export class SiteSetting {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  key: string;

  @Field(() => String)
  value: string;

  @Field(() => SettingGroup)
  group: SettingGroup;

  @Field(() => String)
  label: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => SettingValueType)
  valueType: SettingValueType;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}
