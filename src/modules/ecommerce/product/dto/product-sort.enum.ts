import { registerEnumType } from '@nestjs/graphql';

export enum ProductSortOrder {
  NEWEST = 'NEWEST',
  PRICE_ASC = 'PRICE_ASC',
  PRICE_DESC = 'PRICE_DESC',
}

registerEnumType(ProductSortOrder, { name: 'ProductSortOrder' });
