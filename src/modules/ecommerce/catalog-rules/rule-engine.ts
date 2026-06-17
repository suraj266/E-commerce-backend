/**
 * Catalog rule engine — two evaluators over the SAME RuleSet:
 *
 *   1. ruleToPrismaWhere(rule)   → Prisma.ProductWhereInput
 *      Used for SMART collection membership + label-filtered product queries.
 *
 *   2. productMatchesRule(p, r)  → boolean
 *      A cheap JS predicate over an already-fetched product projection, used
 *      to tag products with AUTO labels at read time (no extra query).
 *
 *   3. validateRuleSet(value)    → RuleSet (throws on malformed input)
 *      Guards admin-supplied rule JSON before it's persisted.
 */

import { Prisma } from '@prisma/client';
import {
  isBooleanField,
  isIdField,
  isNumberField,
  RULE_FIELDS,
  RULE_OPS,
  type ProductRuleProjection,
  type RuleCondition,
  type RuleField,
  type RuleOp,
  type RuleSet,
} from './rule.types';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// 1. RuleSet -> Prisma where
// ---------------------------------------------------------------------------

/**
 * Translate a RuleSet into a Prisma `where` fragment for Product. Intended to
 * be AND-merged with the caller's base filter (active product + active store).
 * An empty / null rule returns `{}` (matches nothing extra).
 */
export function ruleToPrismaWhere(
  rule: RuleSet | null | undefined,
  now: Date = new Date(),
): Prisma.ProductWhereInput {
  if (!rule || rule.conditions.length === 0) return {};
  const parts = rule.conditions.map((c) => conditionToWhere(c, now));
  return rule.match === 'ANY' ? { OR: parts } : { AND: parts };
}

function conditionToWhere(
  c: RuleCondition,
  now: Date,
): Prisma.ProductWhereInput {
  switch (c.field) {
    case 'onSale':
      return { onSale: Boolean(c.value) };
    case 'isFeatured':
      return { isFeatured: Boolean(c.value) };
    case 'ageDays': {
      // ageDays <= N  ⇒  createdAt >= now - N days   (newer than N days)
      // ageDays >= N  ⇒  createdAt <= now - N days   (older than N days)
      const days = Number(c.value);
      const boundary = new Date(now.getTime() - days * DAY_MS);
      if (c.op === 'lte' || c.op === 'lt') return { createdAt: { gte: boundary } };
      if (c.op === 'gte' || c.op === 'gt') return { createdAt: { lte: boundary } };
      return {};
    }
    case 'price':
      return { basePrice: numericFilter(c.op, Number(c.value)) };
    case 'unitsSold7d':
      return { unitsSold7d: numericFilter(c.op, Number(c.value)) };
    case 'unitsSold30d':
      return { unitsSold30d: numericFilter(c.op, Number(c.value)) };
    case 'categoryId':
      return idFilter('categoryId', c);
    case 'brandId':
      return idFilter('brandId', c);
    case 'tagId':
      return c.op === 'in'
        ? { tags: { some: { id: { in: asStringArray(c.value) } } } }
        : { tags: { some: { id: String(c.value) } } };
    default:
      return {};
  }
}

/**
 * A structural numeric filter assignable to BOTH Prisma IntFilter (unitsSold*)
 * and DecimalFilter (basePrice) — both accept `number` for these comparisons.
 */
type NumericFilter = {
  equals?: number;
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  not?: number;
};

function numericFilter(op: RuleOp, value: number): NumericFilter {
  switch (op) {
    case 'lt':
      return { lt: value };
    case 'lte':
      return { lte: value };
    case 'gt':
      return { gt: value };
    case 'gte':
      return { gte: value };
    case 'neq':
      return { not: value };
    case 'eq':
    default:
      return { equals: value };
  }
}

function idFilter(
  field: 'categoryId' | 'brandId',
  c: RuleCondition,
): Prisma.ProductWhereInput {
  if (c.op === 'in') return { [field]: { in: asStringArray(c.value) } };
  if (c.op === 'neq') return { [field]: { not: String(c.value) } };
  return { [field]: String(c.value) };
}

// ---------------------------------------------------------------------------
// 2. JS predicate over a fetched product
// ---------------------------------------------------------------------------

export function productMatchesRule(
  p: ProductRuleProjection,
  rule: RuleSet | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!rule || rule.conditions.length === 0) return false;
  const results = rule.conditions.map((c) => conditionMatches(p, c, now));
  return rule.match === 'ANY'
    ? results.some(Boolean)
    : results.every(Boolean);
}

function conditionMatches(
  p: ProductRuleProjection,
  c: RuleCondition,
  now: Date,
): boolean {
  switch (c.field) {
    case 'onSale':
      return p.onSale === Boolean(c.value);
    case 'isFeatured':
      return p.isFeatured === Boolean(c.value);
    case 'ageDays': {
      const ageDays = (now.getTime() - p.createdAt.getTime()) / DAY_MS;
      return compareNumber(ageDays, c.op, Number(c.value));
    }
    case 'price':
      return p.price != null && compareNumber(p.price, c.op, Number(c.value));
    case 'unitsSold7d':
      return compareNumber(p.unitsSold7d, c.op, Number(c.value));
    case 'unitsSold30d':
      return compareNumber(p.unitsSold30d, c.op, Number(c.value));
    case 'categoryId':
      return idMatches(p.categoryId, c);
    case 'brandId':
      return idMatches(p.brandId, c);
    case 'tagId':
      return c.op === 'in'
        ? asStringArray(c.value).some((id) => p.tagIds.includes(id))
        : p.tagIds.includes(String(c.value));
    default:
      return false;
  }
}

function compareNumber(a: number, op: RuleOp, b: number): boolean {
  switch (op) {
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'neq':
      return a !== b;
    case 'eq':
    default:
      return a === b;
  }
}

function idMatches(value: string | null, c: RuleCondition): boolean {
  if (c.op === 'in') return value != null && asStringArray(c.value).includes(value);
  if (c.op === 'neq') return value !== String(c.value);
  return value === String(c.value);
}

// ---------------------------------------------------------------------------
// 3. Validation
// ---------------------------------------------------------------------------

/**
 * Validate + normalize admin-supplied rule JSON. Throws Error on malformed
 * shape so resolvers can surface a BadRequest. Returns a clean RuleSet.
 */
export function validateRuleSet(value: unknown): RuleSet {
  if (typeof value !== 'object' || value === null) {
    throw new Error('rule must be an object { match, conditions }');
  }
  const obj = value as Record<string, unknown>;
  const match = obj.match;
  if (match !== 'ALL' && match !== 'ANY') {
    throw new Error('rule.match must be "ALL" or "ANY"');
  }
  if (!Array.isArray(obj.conditions) || obj.conditions.length === 0) {
    throw new Error('rule.conditions must be a non-empty array');
  }
  const conditions: RuleCondition[] = obj.conditions.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`rule.conditions[${i}] must be an object`);
    }
    const c = raw as Record<string, unknown>;
    const field = c.field as RuleField;
    const op = c.op as RuleOp;
    if (!RULE_FIELDS.includes(field)) {
      throw new Error(`rule.conditions[${i}].field "${String(c.field)}" is invalid`);
    }
    if (!RULE_OPS.includes(op)) {
      throw new Error(`rule.conditions[${i}].op "${String(c.op)}" is invalid`);
    }
    const v = c.value;
    if (isBooleanField(field) && typeof v !== 'boolean') {
      throw new Error(`rule.conditions[${i}].value must be boolean for "${field}"`);
    }
    if (isNumberField(field) && typeof v !== 'number') {
      throw new Error(`rule.conditions[${i}].value must be number for "${field}"`);
    }
    if (isIdField(field)) {
      const ok =
        op === 'in'
          ? Array.isArray(v) && v.every((x) => typeof x === 'string')
          : typeof v === 'string';
      if (!ok) {
        throw new Error(
          `rule.conditions[${i}].value must be a string${op === 'in' ? '[]' : ''} for "${field}"`,
        );
      }
    }
    return { field, op, value: v as RuleCondition['value'] };
  });
  return { match, conditions };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [String(v)];
}
