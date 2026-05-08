import {
  ObjectType,
  Field,
  ID,
  Int,
  registerEnumType,
} from '@nestjs/graphql';
import { SliderStatus } from '@prisma/client';
import { SlideItem } from './slide-item.entity';

registerEnumType(SliderStatus, { name: 'SliderStatus' });

@ObjectType()
export class Slider {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String, {
    description:
      'Stable identifier used by page blocks to reference this slider. Auto-derived from name on create; admin-editable.',
  })
  key: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => SliderStatus)
  status: SliderStatus;

  @Field(() => String, {
    description:
      'JSON-stringified config (style, autoplay interval, etc.). Frontend parses.',
  })
  config: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  deletedAt?: Date | null;

  /** Hydrated by service. Public query returns enabled-only, ordered. */
  @Field(() => [SlideItem], { nullable: true })
  items?: SlideItem[];
}

@ObjectType()
export class PaginatedSliders {
  @Field(() => [Slider])
  items: Slider[];

  @Field(() => Int)
  totalCount: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;

  @Field(() => Int)
  pageSize: number;
}
