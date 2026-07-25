import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaults = [
  {
    key: 'show_price_with_tax',
    value: 'false',
    group: 'GENERAL' as const,
    label: 'Show Prices With Tax',
    description:
      'When enabled, product prices on the storefront will include tax (e.g. ₹100 → ₹118 for 18% GST). Cart and checkout totals will also reflect tax-inclusive pricing.',
    valueType: 'BOOLEAN' as const,
  },
  {
    key: 'platform_name',
    value: 'Ecommerce',
    group: 'GENERAL' as const,
    label: 'Platform / Brand Name',
    description:
      'Your brand name. Shown in the storefront header, admin panel, tax invoices and every transactional email (and used as the fallback text wherever no logo is set).',
    valueType: 'STRING' as const,
  },
  {
    key: 'platform_logo_url',
    value: '',
    group: 'GENERAL' as const,
    label: 'Platform Logo URL',
    description:
      'Global brand logo, managed from Settings → Branding. Must be an absolute, publicly-reachable URL — it is referenced directly in transactional emails (email clients cannot load localhost or data URIs) and inlined into invoice PDFs. Leave empty to fall back to the brand name text.',
    valueType: 'STRING' as const,
  },
  {
    key: 'platform_logo_height',
    value: '32',
    group: 'GENERAL' as const,
    label: 'Logo Height (px)',
    description:
      'Rendered height of the logo (in pixels) across the storefront header, admin panel, and admin login. Width scales automatically to preserve aspect ratio. Typical range: 24–64.',
    valueType: 'NUMBER' as const,
  },
  {
    key: 'ops_alert_email',
    value: '',
    group: 'EMAIL' as const,
    label: 'Ops Alert Email',
    description:
      'Operations inbox that receives courier NDR/RTO exception alerts alongside the seller (Phase 3 P3-11). Leave empty to alert only the seller — no placeholder is ever emailed.',
    valueType: 'STRING' as const,
  },
];

async function main() {
  for (const d of defaults) {
    await prisma.siteSetting.upsert({
      where: { key: d.key },
      update: {},
      create: {
        key: d.key,
        value: d.value,
        group: d.group,
        label: d.label,
        description: d.description,
        valueType: d.valueType,
      },
    });
  }

  console.log(`✓ Seeded ${defaults.length} site settings.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
