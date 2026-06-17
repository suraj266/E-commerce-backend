/**
 * =============================================================================
 * Collections seeder
 * =============================================================================
 *
 * Seeds a few demo collections to showcase both kinds:
 *   - "New Arrivals" (SMART)      → products created in the last 30 days
 *   - "On Sale"      (SMART)      → products with a live discount
 *   - "Trending"     (SMART)      → top sellers (unitsSold30d >= 1 for demo)
 *   - "Editor's Picks" (MANUAL)   → empty by default; admin hand-picks
 *
 * Idempotent: upsert by slug. Preserves admin edits on re-run; pass --reset to
 * restore rule defaults.
 *
 * Run:  pnpm seed:collections  |  pnpm seed:collections:prod
 * =============================================================================
 */

import { PrismaClient, CollectionType, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const reset = process.argv.includes('--reset');

interface SeedCollection {
  slug: string;
  name: string;
  description: string;
  type: CollectionType;
  rule?: Prisma.InputJsonValue;
  isFeatured: boolean;
  displayOrder: number;
}

const COLLECTIONS: SeedCollection[] = [
  {
    slug: 'new-arrivals',
    name: 'New Arrivals',
    description: 'Fresh drops from the last 30 days.',
    type: CollectionType.SMART,
    rule: { match: 'ALL', conditions: [{ field: 'ageDays', op: 'lte', value: 30 }] },
    isFeatured: true,
    displayOrder: 10,
  },
  {
    slug: 'on-sale',
    name: 'On Sale',
    description: 'Everything currently discounted.',
    type: CollectionType.SMART,
    rule: { match: 'ALL', conditions: [{ field: 'onSale', op: 'eq', value: true }] },
    isFeatured: true,
    displayOrder: 20,
  },
  {
    slug: 'trending',
    name: 'Trending',
    description: 'What shoppers are buying right now.',
    type: CollectionType.SMART,
    rule: { match: 'ALL', conditions: [{ field: 'unitsSold30d', op: 'gte', value: 1 }] },
    isFeatured: true,
    displayOrder: 30,
  },
  {
    slug: 'editors-picks',
    name: "Editor's Picks",
    description: 'Hand-curated favourites.',
    type: CollectionType.MANUAL,
    isFeatured: false,
    displayOrder: 40,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const c of COLLECTIONS) {
    const existing = await prisma.collection.findUnique({ where: { slug: c.slug } });
    if (!existing) {
      await prisma.collection.create({
        data: {
          slug: c.slug,
          name: c.name,
          description: c.description,
          type: c.type,
          rule: c.rule ?? Prisma.JsonNull,
          isFeatured: c.isFeatured,
          displayOrder: c.displayOrder,
          status: 'ACTIVE',
        },
      });
      created++;
    } else {
      await prisma.collection.update({
        where: { slug: c.slug },
        data: {
          name: c.name,
          description: c.description,
          type: c.type,
          isFeatured: c.isFeatured,
          displayOrder: c.displayOrder,
          ...(reset ? { rule: c.rule ?? Prisma.JsonNull } : {}),
        },
      });
      updated++;
    }
  }

  console.log(
    `[collections.seed] Done. created=${created} updated=${updated}${reset ? ' (defaults reset)' : ''}.`,
  );
}

main()
  .catch((e) => {
    console.error('[collections.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
