import { timingSafeEqualStr } from './timing-safe.util';

describe('timingSafeEqualStr', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqualStr('abc123', 'abc123')).toBe(true);
  });

  it('returns false for same-length but different strings', () => {
    expect(timingSafeEqualStr('abc123', 'abc124')).toBe(false);
  });

  it('returns false for different-length strings (no throw)', () => {
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
  });

  it('handles null / undefined without throwing', () => {
    expect(timingSafeEqualStr(null, 'x')).toBe(false);
    expect(timingSafeEqualStr(undefined, undefined)).toBe(true);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});
