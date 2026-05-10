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
