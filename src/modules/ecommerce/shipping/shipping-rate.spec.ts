import {
  computeSellerShipping,
  isCodEligible,
  isServiceable,
  isValidPincode,
  parseShippingConfig,
  DEFAULT_ITEM_WEIGHT_KG,
  type ShippingConfig,
} from './shipping-rate';

const baseConfig: ShippingConfig = {
  freeAbove: 499,
  flatRate: 49,
  perKgRate: 20,
  codEnabled: true,
  codLimit: 2000,
  excludedPincodes: [],
};

describe('computeSellerShipping', () => {
  it('charges flat + per-kg below the free threshold', () => {
    const r = computeSellerShipping({
      items: [{ weight: 1, qty: 1 }],
      merchandiseSubtotal: 300,
      config: baseConfig,
    });
    expect(r.freeApplied).toBe(false);
    expect(r.billableWeightKg).toBe(1);
    expect(r.shippingCharge).toBe(69); // 49 + 20*1
  });

  it('applies free shipping at/above the threshold', () => {
    const r = computeSellerShipping({
      items: [{ weight: 3, qty: 2 }],
      merchandiseSubtotal: 499,
      config: baseConfig,
    });
    expect(r.freeApplied).toBe(true);
    expect(r.shippingCharge).toBe(0);
  });

  it('defaults missing weight to DEFAULT_ITEM_WEIGHT_KG and ceils billable weight', () => {
    const r = computeSellerShipping({
      items: [{ weight: null, qty: 3 }], // 3 * 0.5 = 1.5kg
      merchandiseSubtotal: 100,
      config: baseConfig,
    });
    expect(DEFAULT_ITEM_WEIGHT_KG).toBe(0.5);
    expect(r.billableWeightKg).toBe(1.5);
    expect(r.shippingCharge).toBe(79); // 49 + 20*1.5
  });

  it('ships free when flatRate is unset (never-configured store)', () => {
    const r = computeSellerShipping({
      items: [{ weight: 5, qty: 1 }],
      merchandiseSubtotal: 100,
      config: parseShippingConfig({}),
    });
    expect(r.shippingCharge).toBe(0);
  });

  it('treats null freeAbove as never-free', () => {
    const r = computeSellerShipping({
      items: [{ weight: 0.2, qty: 1 }],
      merchandiseSubtotal: 100000,
      config: { flatRate: 49, freeAbove: null },
    });
    expect(r.freeApplied).toBe(false);
    expect(r.shippingCharge).toBe(49);
  });
});

describe('isCodEligible', () => {
  it('requires codEnabled', () => {
    expect(isCodEligible({ flatRate: 0, codEnabled: false }, 100)).toBe(false);
  });
  it('allows when within the limit', () => {
    expect(isCodEligible(baseConfig, 2000)).toBe(true);
    expect(isCodEligible(baseConfig, 2001)).toBe(false);
  });
  it('allows any amount when no limit is set', () => {
    expect(isCodEligible({ flatRate: 0, codEnabled: true, codLimit: null }, 9_99_999)).toBe(true);
  });
});

describe('pincode serviceability', () => {
  it('validates Indian PIN format', () => {
    expect(isValidPincode('560001')).toBe(true);
    expect(isValidPincode('000001')).toBe(false); // leading zero
    expect(isValidPincode('12345')).toBe(false); // 5 digits
    expect(isValidPincode('abcdef')).toBe(false);
  });
  it('is serviceable by default but not for excluded pincodes', () => {
    expect(isServiceable(baseConfig, '560001')).toBe(true);
    expect(isServiceable({ ...baseConfig, excludedPincodes: ['560001'] }, '560001')).toBe(false);
  });
});

describe('parseShippingConfig', () => {
  it('coerces junk to safe defaults', () => {
    const c = parseShippingConfig({ flatRate: '49', freeAbove: -5, codEnabled: 'yes' });
    expect(c.flatRate).toBe(49);
    expect(c.freeAbove).toBeNull(); // negative rejected
    expect(c.codEnabled).toBe(false); // only boolean true counts
    expect(c.excludedPincodes).toEqual([]);
  });
});
