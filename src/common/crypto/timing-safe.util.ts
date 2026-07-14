import { timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison for secrets/HMACs.
 *
 * A plain `===` short-circuits on the first differing byte, leaking timing
 * information an attacker can use to recover a signature/token byte by byte.
 * This compares in constant time. The length pre-filter is required because
 * `crypto.timingSafeEqual` throws on buffers of unequal length; for hex HMACs
 * and API tokens the length itself is not secret.
 */
export function timingSafeEqualStr(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const bufA = Buffer.from(a ?? '', 'utf8');
  const bufB = Buffer.from(b ?? '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
