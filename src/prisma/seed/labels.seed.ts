/**
 * =============================================================================
 * Product labels seeder
 * =============================================================================
 *
 * Upserts the system AUTO labels (data-driven badges) + a couple of MANUAL
 * example labels. AUTO labels carry a RuleSet evaluated per product at read
 * time:
 *   - sale       : onSale (any variant compareAtPrice > price)
 *   - new        : created within 30 days
 *   - bestseller : unitsSold30d >= 25   (from the sales-stats job)
 *   - trending   : unitsSold7d  >= 10
 *
 * Idempotent: upsert by key. Preserves admin edits to colour/priority/rule on
 * re-run (only fills on create); pass --reset to restore rule/colour defaults.
 *
 * Run:  pnpm seed:labels  |  pnpm seed:labels:prod
 * =============================================================================
 */

import { PrismaClient, LabelType, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const reset = process.argv.includes('--reset');

interface SeedLabel {
  key: string;
  name: string;
  color: string;
  textColor?: string;
  icon?: string;
  type: LabelType;
  rule?: Prisma.InputJsonValue;
  priority: number;
  isSystem: boolean;
}

const LABELS: SeedLabel[] = [
  {
    key: 'sale',
    name: 'Sale',
    color: '#ef4444',
    textColor: '#ffffff',
    type: LabelType.AUTO,
    rule: { match: 'ALL', conditions: [{ field: 'onSale', op: 'eq', value: true }] },
    priority: 10,
    isSystem: true,
  },
  {
    key: 'bestseller',
    name: 'Bestseller',
    color: '#f59e0b',
    textColor: '#ffffff',
    type: LabelType.AUTO,
    rule: {
      match: 'ALL',
      conditions: [{ field: 'unitsSold30d', op: 'gte', value: 25 }],
    },
    priority: 15,
    isSystem: true,
  },
  {
    key: 'new',
    name: 'New',
    color: '#10b981',
    textColor: '#ffffff',
    type: LabelType.AUTO,
    rule: {
      match: 'ALL',
      conditions: [{ field: 'ageDays', op: 'lte', value: 30 }],
    },
    priority: 20,
    isSystem: true,
  },
  {
    key: 'trending',
    name: 'Trending',
    color: '#6366f1',
    textColor: '#ffffff',
    type: LabelType.AUTO,
    rule: {
      match: 'ALL',
      conditions: [{ field: 'unitsSold7d', op: 'gte', value: 10 }],
    },
    priority: 25,
    isSystem: true,
  },
  // Manual example labels — editorial badges admins assign per product.
  {
    key: 'hot',
    name: 'Hot',
    color: '#f97316',
    textColor: '#ffffff',
    type: LabelType.MANUAL,
    priority: 18,
    isSystem: false,
  },
  {
    key: 'limited',
    name: 'Limited',
    color: '#a855f7',
    textColor: '#ffffff',
    type: LabelType.MANUAL,
    priority: 30,
    isSystem: false,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const l of LABELS) {
    const existing = await prisma.label.findUnique({ where: { key: l.key } });
    if (!existing) {
      await prisma.label.create({
        data: {
          key: l.key,
          name: l.name,
          color: l.color,
          textColor: l.textColor,
          icon: l.icon,
          type: l.type,
          rule: l.rule ?? Prisma.JsonNull,
          priority: l.priority,
          isSystem: l.isSystem,
        },
      });
      created++;
    } else {
      await prisma.label.update({
        where: { key: l.key },
        data: {
          name: l.name,
          type: l.type,
          isSystem: l.isSystem,
          ...(reset
            ? {
                color: l.color,
                textColor: l.textColor,
                priority: l.priority,
                rule: l.rule ?? Prisma.JsonNull,
              }
            : {}),
        },
      });
      updated++;
    }
  }

  console.log(
    `[labels.seed] Done. created=${created} updated=${updated}${reset ? ' (defaults reset)' : ''}.`,
  );
}

main()
  .catch((e) => {
    console.error('[labels.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
