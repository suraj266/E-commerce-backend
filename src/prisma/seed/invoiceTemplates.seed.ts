/**
 * =============================================================================
 * Invoice template seeder
 * =============================================================================
 *
 * Upserts the canonical `tax_invoice` template into the InvoiceTemplate table.
 * The PDF generator renders from this DB row (not a file), and admins edit it
 * from the admin panel. Idempotent: re-running refreshes name/description/
 * variables but PRESERVES any admin edits to htmlBody/css (only fills them on
 * first create) — mirrors how categories.seed preserves admin edits.
 *
 * To force-reset the body/css back to the shipped default, pass --reset:
 *   pnpm seed:invoices --reset
 *
 * Run:  pnpm seed:invoices  (ts-node)  |  pnpm seed:invoices:prod  (compiled)
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_TAX_INVOICE_HBS,
  DEFAULT_TAX_INVOICE_CSS,
  TAX_INVOICE_VARIABLES,
  TAX_INVOICE_TEMPLATE_KEY,
} from '../../modules/ecommerce/invoice/templates/tax-invoice.default';

const prisma = new PrismaClient();

const reset = process.argv.includes('--reset');

async function main() {
  const existing = await prisma.invoiceTemplate.findUnique({
    where: { key: TAX_INVOICE_TEMPLATE_KEY },
  });

  if (!existing) {
    await prisma.invoiceTemplate.create({
      data: {
        key: TAX_INVOICE_TEMPLATE_KEY,
        name: 'Tax Invoice',
        description:
          'GST tax invoice (CGST Rule 46). Rendered to PDF per seller order. ' +
          'Supports intra-state (CGST+SGST) and inter-state (IGST) layouts.',
        htmlBody: DEFAULT_TAX_INVOICE_HBS,
        css: DEFAULT_TAX_INVOICE_CSS,
        variables: TAX_INVOICE_VARIABLES,
        isEnabled: true,
        isSystem: true,
      },
    });
    console.log('[invoiceTemplates.seed] Created "tax_invoice" template.');
    return;
  }

  // Existing row — refresh metadata (and body/css only on --reset).
  await prisma.invoiceTemplate.update({
    where: { key: TAX_INVOICE_TEMPLATE_KEY },
    data: {
      name: 'Tax Invoice',
      description:
        'GST tax invoice (CGST Rule 46). Rendered to PDF per seller order. ' +
        'Supports intra-state (CGST+SGST) and inter-state (IGST) layouts.',
      variables: TAX_INVOICE_VARIABLES,
      isSystem: true,
      ...(reset
        ? { htmlBody: DEFAULT_TAX_INVOICE_HBS, css: DEFAULT_TAX_INVOICE_CSS }
        : {}),
    },
  });
  console.log(
    `[invoiceTemplates.seed] Updated "tax_invoice" template${
      reset ? ' (body/css reset to default)' : ' (admin edits preserved)'
    }.`,
  );
}

main()
  .catch((e) => {
    console.error('[invoiceTemplates.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
