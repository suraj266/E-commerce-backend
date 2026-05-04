/**
 * =============================================================================
 * Taxes seeder
 * =============================================================================
 *
 * Idempotent upsert of common Indian GST rates. Re-running won't duplicate
 * and won't overwrite admin edits to description / displayOrder. Soft-deleted
 * rows with the same name are revived.
 *
 * Run:
 *   pnpm seed:taxes      (compiled)
 *   pnpm seed:taxes:dev  (ts-node)
 *
 * Inside Docker:
 *   docker exec ecommerce_backend_dev pnpm seed:taxes:dev
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedTax {
  name: string;
  rate: number;
  description: string;
  displayOrder: number;
}

const seeds: SeedTax[] = [
  {
    name: 'No Tax (0%)',
    rate: 0,
    description:
      'Tax-exempt goods — fresh produce, certain books, healthcare items, etc.',
    displayOrder: 0,
  },
  {
    name: 'GST 5%',
    rate: 5,
    description:
      'Essential goods — packaged food, footwear under ₹1000, life-saving drugs.',
    displayOrder: 1,
  },
  {
    name: 'GST 12%',
    rate: 12,
    description:
      'Standard rate — processed foods, mobile phones (older slabs), some apparel.',
    displayOrder: 2,
  },
  {
    name: 'GST 18%',
    rate: 18,
    description:
      'Most common slab — electronics, restaurants, services, soap, toothpaste.',
    displayOrder: 3,
  },
  {
    name: 'GST 28%',
    rate: 28,
    description:
      'Luxury / sin goods — passenger vehicles, ACs, premium cosmetics.',
    displayOrder: 4,
  },
];

async function main() {
  let created = 0;
  let updated = 0;
  let revived = 0;

  for (const seed of seeds) {
    const existing = await prisma.tax.findUnique({
      where: { name: seed.name },
    });

    if (!existing) {
      await prisma.tax.create({
        data: {
          name: seed.name,
          rate: seed.rate,
          description: seed.description,
          displayOrder: seed.displayOrder,
          isActive: true,
        },
      });
      created += 1;
      continue;
    }

    // Idempotent: only touch fields that are still defaults / soft-deleted.
    // Preserve admin edits to description and displayOrder.
    const dataToUpdate: {
      rate?: number;
      deletedAt?: Date | null;
      isActive?: boolean;
    } = {};
    if (Number(existing.rate) !== seed.rate) dataToUpdate.rate = seed.rate;
    if (existing.deletedAt !== null) {
      dataToUpdate.deletedAt = null;
      dataToUpdate.isActive = true;
      revived += 1;
    }
    if (Object.keys(dataToUpdate).length > 0) {
      await prisma.tax.update({ where: { id: existing.id }, data: dataToUpdate });
      updated += 1;
    }
  }

  console.log(
    `[taxes.seed] Done. created=${created} updated=${updated} revived=${revived}`,
  );
}

main()
  .catch((e) => {
    console.error('[taxes.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
