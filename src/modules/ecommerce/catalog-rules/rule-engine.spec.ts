import {
  productMatchesRule,
  ruleToPrismaWhere,
  validateRuleSet,
} from './rule-engine';
import type { ProductRuleProjection, RuleSet } from './rule.types';

const NOW = new Date('2026-05-31T00:00:00Z');

function product(over: Partial<ProductRuleProjection> = {}): ProductRuleProjection {
  return {
    onSale: false,
    createdAt: new Date('2026-05-20T00:00:00Z'), // 11 days old
    categoryId: 'cat-1',
    brandId: 'brand-1',
    tagIds: ['tag-1', 'tag-2'],
    price: 1000,
    unitsSold7d: 0,
    unitsSold30d: 0,
    isFeatured: false,
    ...over,
  };
}

describe('productMatchesRule', () => {
  it('onSale rule matches an on-sale product', () => {
    const rule: RuleSet = { match: 'ALL', conditions: [{ field: 'onSale', op: 'eq', value: true }] };
    expect(productMatchesRule(product({ onSale: true }), rule, NOW)).toBe(true);
    expect(productMatchesRule(product({ onSale: false }), rule, NOW)).toBe(false);
  });

  it('ageDays <= 30 matches recent product (new arrival)', () => {
    const rule: RuleSet = { match: 'ALL', conditions: [{ field: 'ageDays', op: 'lte', value: 30 }] };
    expect(productMatchesRule(product(), rule, NOW)).toBe(true); // 11 days
    expect(
      productMatchesRule(product({ createdAt: new Date('2026-01-01T00:00:00Z') }), rule, NOW),
    ).toBe(false); // ~150 days
  });

  it('unitsSold30d >= 50 matches a bestseller', () => {
    const rule: RuleSet = {
      match: 'ALL',
      conditions: [{ field: 'unitsSold30d', op: 'gte', value: 50 }],
    };
    expect(productMatchesRule(product({ unitsSold30d: 80 }), rule, NOW)).toBe(true);
    expect(productMatchesRule(product({ unitsSold30d: 10 }), rule, NOW)).toBe(false);
  });

  it('ALL requires every condition; ANY requires one', () => {
    const conds = [
      { field: 'onSale', op: 'eq', value: true } as const,
      { field: 'unitsSold30d', op: 'gte', value: 50 } as const,
    ];
    const all: RuleSet = { match: 'ALL', conditions: [...conds] };
    const any: RuleSet = { match: 'ANY', conditions: [...conds] };
    const p = product({ onSale: true, unitsSold30d: 10 });
    expect(productMatchesRule(p, all, NOW)).toBe(false); // only one true
    expect(productMatchesRule(p, any, NOW)).toBe(true); // one true is enough
  });

  it('categoryId in [...] matches', () => {
    const rule: RuleSet = {
      match: 'ALL',
      conditions: [{ field: 'categoryId', op: 'in', value: ['cat-1', 'cat-9'] }],
    };
    expect(productMatchesRule(product(), rule, NOW)).toBe(true);
    expect(productMatchesRule(product({ categoryId: 'cat-x' }), rule, NOW)).toBe(false);
  });

  it('tagId membership matches', () => {
    const rule: RuleSet = { match: 'ALL', conditions: [{ field: 'tagId', op: 'eq', value: 'tag-2' }] };
    expect(productMatchesRule(product(), rule, NOW)).toBe(true);
    expect(productMatchesRule(product({ tagIds: [] }), rule, NOW)).toBe(false);
  });

  it('empty/no rule never matches', () => {
    expect(productMatchesRule(product(), null, NOW)).toBe(false);
    expect(productMatchesRule(product(), { match: 'ALL', conditions: [] }, NOW)).toBe(false);
  });
});

describe('ruleToPrismaWhere', () => {
  it('onSale → { AND: [{ onSale: true }] }', () => {
    const where = ruleToPrismaWhere(
      { match: 'ALL', conditions: [{ field: 'onSale', op: 'eq', value: true }] },
      NOW,
    );
    expect(where).toEqual({ AND: [{ onSale: true }] });
  });

  it('ageDays lte 30 → createdAt gte boundary', () => {
    const where = ruleToPrismaWhere(
      { match: 'ALL', conditions: [{ field: 'ageDays', op: 'lte', value: 30 }] },
      NOW,
    );
    const boundary = new Date(NOW.getTime() - 30 * 86_400_000);
    expect(where).toEqual({ AND: [{ createdAt: { gte: boundary } }] });
  });

  it('ANY match → OR', () => {
    const where = ruleToPrismaWhere(
      {
        match: 'ANY',
        conditions: [
          { field: 'onSale', op: 'eq', value: true },
          { field: 'unitsSold30d', op: 'gte', value: 50 },
        ],
      },
      NOW,
    );
    expect(where).toEqual({
      OR: [{ onSale: true }, { unitsSold30d: { gte: 50 } }],
    });
  });

  it('tagId in → tags.some.id.in', () => {
    const where = ruleToPrismaWhere(
      { match: 'ALL', conditions: [{ field: 'tagId', op: 'in', value: ['t1', 't2'] }] },
      NOW,
    );
    expect(where).toEqual({ AND: [{ tags: { some: { id: { in: ['t1', 't2'] } } } }] });
  });

  it('null rule → {}', () => {
    expect(ruleToPrismaWhere(null, NOW)).toEqual({});
  });
});

describe('validateRuleSet', () => {
  it('accepts a well-formed rule', () => {
    const r = validateRuleSet({
      match: 'ALL',
      conditions: [{ field: 'unitsSold30d', op: 'gte', value: 50 }],
    });
    expect(r.match).toBe('ALL');
    expect(r.conditions).toHaveLength(1);
  });

  it('rejects bad match', () => {
    expect(() => validateRuleSet({ match: 'MAYBE', conditions: [] })).toThrow(/match/);
  });

  it('rejects empty conditions', () => {
    expect(() => validateRuleSet({ match: 'ALL', conditions: [] })).toThrow(/non-empty/);
  });

  it('rejects wrong value type', () => {
    expect(() =>
      validateRuleSet({ match: 'ALL', conditions: [{ field: 'onSale', op: 'eq', value: 5 }] }),
    ).toThrow(/boolean/);
    expect(() =>
      validateRuleSet({
        match: 'ALL',
        conditions: [{ field: 'unitsSold30d', op: 'gte', value: 'lots' }],
      }),
    ).toThrow(/number/);
  });

  it('rejects unknown field', () => {
    expect(() =>
      validateRuleSet({ match: 'ALL', conditions: [{ field: 'magic', op: 'eq', value: 1 }] }),
    ).toThrow(/field/);
  });
});
