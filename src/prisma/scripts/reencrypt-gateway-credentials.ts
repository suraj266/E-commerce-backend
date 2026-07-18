/**
 * =============================================================================
 * reencrypt-gateway-credentials.ts — one-shot PAYMENT_ENCRYPTION_KEY rotation
 * =============================================================================
 *
 * Rotating PAYMENT_ENCRYPTION_KEY naively BRICKS every saved gateway credential:
 * PaymentGatewayConfig.credentials is AES-256-GCM ciphertext bound to the key
 * that produced it. This script bridges the gap — it decrypts each row with the
 * OLD key and re-encrypts with the NEW key, atomically, so nothing is lost.
 *
 * It deliberately does NOT import CryptoService (that provider only holds one
 * key). The AES primitives live in ./gcm-crypto.util.ts and are unit-tested.
 *
 * -----------------------------------------------------------------------------
 * USAGE (run from the backend/ directory, or inside the backend container):
 *
 *   export OLD_PAYMENT_ENCRYPTION_KEY=<current 64-hex key, the one in .env now>
 *   export NEW_PAYMENT_ENCRYPTION_KEY=<freshly minted 64-hex key>
 *
 *   # 1) Dry run — round-trips every row in memory, writes NOTHING:
 *   pnpm reencrypt:gateway-creds -- --dry-run
 *
 *   # 2) For real — all rows updated in a single transaction (all-or-nothing):
 *   pnpm reencrypt:gateway-creds
 *
 * ONLY AFTER a clean real run do you set PAYMENT_ENCRYPTION_KEY=<new> in .env
 * and restart. See backend/docs/SECRETS-ROTATION.md for the full runbook.
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import {
  decryptGcm,
  isValidKeyHex,
  maskSecret,
  reencrypt,
} from './gcm-crypto.util';

const DRY_RUN = process.argv.includes('--dry-run');

function readKeys(): { oldKey: string; newKey: string } {
  const oldKey = process.env.OLD_PAYMENT_ENCRYPTION_KEY;
  const newKey = process.env.NEW_PAYMENT_ENCRYPTION_KEY;

  const problems: string[] = [];
  if (!isValidKeyHex(oldKey)) {
    problems.push('OLD_PAYMENT_ENCRYPTION_KEY must be set to a 64-char hex string (the key currently in .env).');
  }
  if (!isValidKeyHex(newKey)) {
    problems.push('NEW_PAYMENT_ENCRYPTION_KEY must be set to a 64-char hex string (the freshly minted key).');
  }
  if (isValidKeyHex(oldKey) && isValidKeyHex(newKey) && oldKey === newKey) {
    problems.push('OLD_ and NEW_PAYMENT_ENCRYPTION_KEY are identical — nothing to rotate.');
  }
  if (problems.length > 0) {
    throw new Error(`Cannot start rotation:\n  - ${problems.join('\n  - ')}`);
  }
  return { oldKey: oldKey as string, newKey: newKey as string };
}

/** Render decrypted credentials JSON as masked key/value hints for the log. */
function maskedHints(json: string): string {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const entries = Object.entries(parsed).map(([k, v]) => `${k}=${maskSecret(v)}`);
    return entries.length ? entries.join(', ') : '(no fields)';
  } catch {
    // Not JSON — mask the raw plaintext without ever printing it.
    return maskSecret(json);
  }
}

async function main(): Promise<void> {
  const { oldKey, newKey } = readKeys();
  const prisma = new PrismaClient();

  console.log('='.repeat(72));
  console.log(`Gateway-credential re-encryption ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE — will write)'}`);
  console.log('='.repeat(72));

  try {
    const rows = await prisma.paymentGatewayConfig.findMany({
      orderBy: { displayOrder: 'asc' },
      select: { id: true, gateway: true, credentials: true },
    });

    console.log(`Found ${rows.length} PaymentGatewayConfig row(s).`);

    const updates: { id: string; credentials: string }[] = [];
    let skipped = 0;

    for (const row of rows) {
      if (!row.credentials || row.credentials.length === 0) {
        console.log(`  · ${row.gateway} (${row.id}) — no credentials, skipping.`);
        skipped++;
        continue;
      }

      // Decrypt with OLD, re-encrypt with NEW, verify round-trip under NEW.
      // Any failure here throws and aborts BEFORE the transaction runs.
      const nextCipher = reencrypt(row.credentials, oldKey, newKey);

      // Log-only proof, using masked values from the decrypted plaintext.
      const hints = maskedHints(decryptGcm(nextCipher, newKey));
      console.log(`  ✓ ${row.gateway} (${row.id}) — re-encrypted OK: ${hints}`);

      updates.push({ id: row.id, credentials: nextCipher });
    }

    console.log('-'.repeat(72));
    console.log(`Prepared ${updates.length} update(s), ${skipped} skipped.`);

    if (updates.length === 0) {
      console.log('Nothing to write. Done.');
      return;
    }

    if (DRY_RUN) {
      console.log('DRY RUN: every row round-tripped successfully. No rows were written.');
      console.log('Re-run WITHOUT --dry-run to commit the rotation.');
      return;
    }

    // All-or-nothing: a single transaction so a mid-run failure leaves the
    // table entirely on the OLD key rather than half-rotated.
    await prisma.$transaction(
      updates.map((u) =>
        prisma.paymentGatewayConfig.update({
          where: { id: u.id },
          data: { credentials: u.credentials },
        }),
      ),
    );

    console.log('-'.repeat(72));
    console.log(`SUCCESS: ${updates.length} row(s) re-encrypted with the new key in one transaction.`);
    console.log('NEXT: set PAYMENT_ENCRYPTION_KEY=<new key> in .env, then restart the backend.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('-'.repeat(72));
  console.error('ROTATION ABORTED — no changes committed.');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
