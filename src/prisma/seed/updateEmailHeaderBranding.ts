/**
 * One-shot: force-update the `email_header` partial so existing DBs pick up the
 * logo-aware branding header.
 *
 * Why this exists: `emailTemplates.seed.ts` only refreshes `description` for
 * rows that already exist (it deliberately preserves admin edits to bodies), so
 * re-running it will NOT push a changed `email_header` body to an already-seeded
 * DB. This script does a targeted update of ONLY the `email_header` partial's
 * `htmlBody` + `variables` from the shared single source of truth.
 *
 * Idempotent and safe to re-run. It overwrites the header body — if an admin
 * hand-customized their header, re-apply that customization afterwards. It does
 * NOT touch any other template.
 *
 * Run: pnpm seed:emails:header
 */

import { PrismaClient } from '@prisma/client';
import {
  EMAIL_HEADER_HTML,
  EMAIL_HEADER_VARIABLES,
} from './email-partials';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.emailTemplate.findUnique({
    where: { key: 'email_header' },
  });

  if (!existing) {
    // Fresh DB path — the normal seed will create it. Nothing to force-update.
    console.log(
      'ℹ email_header not found — run `pnpm seed:emails` to create it first.',
    );
    return;
  }

  await prisma.emailTemplate.update({
    where: { key: 'email_header' },
    data: {
      htmlBody: EMAIL_HEADER_HTML,
      variables: EMAIL_HEADER_VARIABLES,
    },
  });

  console.log('✓ email_header partial updated with logo-aware branding.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
