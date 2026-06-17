/**
 * Catalog rule types — a single condition representation shared by:
 *   - AUTO labels   (a product gets the label if it matches the rule)
 *   - SMART collections (membership = products matching the rule)
 *
 * "One rule, two surfaces" — so "new arrival" / "trending" never drift between
 * a badge and a collection. See rule-engine.ts for the two evaluators.
 */

export type RuleMatch = 'ALL' | 'ANY';

/** Fields a condition can test. Kept small + queryable for v1. */
export type RuleField =
  | 'onSale' // boolean — denormalized Product.onSale (compareAtPrice > price)
  | 'ageDays' // number — days since createdAt
  | 'categoryId' // string (uuid) — Product.categoryId
  | 'brandId' // string (uuid) — Product.brandId
  | 'tagId' // string (uuid) — any of Product.tags
  | 'price' // number — Product.basePrice
  | 'unitsSold7d' // number — sales-velocity stat
  | 'unitsSold30d' // number — sales-velocity stat
  | 'isFeatured'; // boolean — Product.isFeatured

export type RuleOp =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'; // value is string[] — used for id fields

export type RuleValue = boolean | number | string | string[];

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: RuleValue;
}

export interface RuleSet {
  match: RuleMatch;
  conditions: RuleCondition[];
}

/** Minimal product projection the JS predicate needs (already-fetched data). */
export interface ProductRuleProjection {
  onSale: boolean;
  createdAt: Date;
  categoryId: string | null;
  brandId: string | null;
  tagIds: string[];
  price: number | null; // basePrice
  unitsSold7d: number;
  unitsSold30d: number;
  isFeatured: boolean;
}

export const RULE_FIELDS: readonly RuleField[] = [
  'onSale',
  'ageDays',
  'categoryId',
  'brandId',
  'tagId',
  'price',
  'unitsSold7d',
  'unitsSold30d',
  'isFeatured',
];

export const RULE_OPS: readonly RuleOp[] = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
];

/** Fields whose value is a boolean. */
const BOOLEAN_FIELDS: ReadonlySet<RuleField> = new Set(['onSale', 'isFeatured']);
/** Fields whose value is a number. */
const NUMBER_FIELDS: ReadonlySet<RuleField> = new Set([
  'ageDays',
  'price',
  'unitsSold7d',
  'unitsSold30d',
]);
/** Fields whose value is an id (string) / id list. */
const ID_FIELDS: ReadonlySet<RuleField> = new Set([
  'categoryId',
  'brandId',
  'tagId',
]);

export function isBooleanField(f: RuleField): boolean {
  return BOOLEAN_FIELDS.has(f);
}
export function isNumberField(f: RuleField): boolean {
  return NUMBER_FIELDS.has(f);
}
export function isIdField(f: RuleField): boolean {
  return ID_FIELDS.has(f);
}
