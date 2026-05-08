/**
 * =============================================================================
 * Menus seeder
 * =============================================================================
 *
 * Idempotent upsert of 7 starter menus, one per MenuLocation. Re-running
 * never overwrites admin edits to existing menus — only creates rows that
 * are missing. Soft-deleted rows at the same location are revived.
 *
 * Run:
 *   pnpm seed:menus      (compiled)
 *   pnpm seed:menus:dev  (ts-node)
 *
 * Inside Docker:
 *   docker exec ecommerce_backend_dev pnpm seed:menus
 * =============================================================================
 */

import { MenuLocation, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

interface MenuItem {
  id: string;
  label: string;
  url: string;
  target?: '_self' | '_blank';
  icon?: string;
  visible: boolean;
  children: MenuItem[];
}

function item(
  label: string,
  url: string,
  extras: Partial<MenuItem> = {},
): MenuItem {
  return {
    id: randomUUID(),
    label,
    url,
    visible: true,
    children: [],
    ...extras,
  };
}

interface SeedMenu {
  location: MenuLocation;
  name: string;
  items: MenuItem[];
}

const seeds: SeedMenu[] = [
  {
    location: MenuLocation.HEADER_PRIMARY,
    name: 'Header — primary navigation',
    items: [
      item('Home', '/'),
      item('All Products', '/products'),
      {
        ...item('Categories', '/categories'),
        children: [
          item('Electronics', '/category/electronics'),
          item('Home & Kitchen', '/category/home-and-kitchen'),
          item('Beauty & Personal Care', '/category/beauty-and-personal-care'),
          item('Grocery & Gourmet', '/category/grocery-and-gourmet-foods'),
        ],
      },
      item('Brands', '/brands'),
      item('About', '/about'),
    ],
  },
  {
    location: MenuLocation.HEADER_TOP,
    name: 'Header — top strip',
    items: [
      item('Help', '/help'),
      item('Track Order', '/orders'),
    ],
  },
  {
    location: MenuLocation.FOOTER_SHOP,
    name: 'Footer — Shop',
    items: [
      item('All Products', '/products'),
      item('Categories', '/categories'),
      item('Brands', '/brands'),
      item('New Arrivals', '/products?sort=newest'),
    ],
  },
  {
    location: MenuLocation.FOOTER_HELP,
    name: 'Footer — Help & Support',
    items: [
      item('Contact Us', '/help'),
      item('Shipping & Delivery', '/help'),
      item('Returns & Refunds', '/help'),
      item('FAQ', '/help'),
    ],
  },
  {
    location: MenuLocation.FOOTER_COMPANY,
    name: 'Footer — Company',
    items: [
      item('About Us', '/about'),
      item('Careers', '/about'),
      item('Press', '/about'),
      item('Become a Seller', '/seller/register', { target: '_blank' }),
    ],
  },
  {
    location: MenuLocation.FOOTER_LEGAL,
    name: 'Footer — Legal',
    items: [
      item('Terms & Conditions', '/terms'),
      item('Privacy Policy', '/privacy'),
      item('Refund Policy', '/help'),
    ],
  },
  {
    location: MenuLocation.FOOTER_SOCIAL,
    name: 'Footer — Social',
    items: [
      item('Twitter', 'https://twitter.com', {
        target: '_blank',
        icon: 'Twitter',
      }),
      item('Instagram', 'https://instagram.com', {
        target: '_blank',
        icon: 'Instagram',
      }),
      item('Facebook', 'https://facebook.com', {
        target: '_blank',
        icon: 'Facebook',
      }),
      item('YouTube', 'https://youtube.com', {
        target: '_blank',
        icon: 'Youtube',
      }),
    ],
  },
];

async function main() {
  let created = 0;
  let revived = 0;

  for (const seed of seeds) {
    const existing = await prisma.menu.findUnique({
      where: { location: seed.location },
    });

    if (!existing) {
      await prisma.menu.create({
        data: {
          name: seed.name,
          location: seed.location,
          items: seed.items as unknown as object[],
          isActive: true,
        },
      });
      created += 1;
      continue;
    }

    // Idempotent: revive soft-deleted, but never overwrite admin edits to
    // name/items/isActive on an active row.
    if (existing.deletedAt !== null) {
      await prisma.menu.update({
        where: { id: existing.id },
        data: { deletedAt: null, isActive: true },
      });
      revived += 1;
    }
  }

  console.log(
    `[menus.seed] Done. created=${created} revived=${revived}`,
  );
}

main()
  .catch((e) => {
    console.error('[menus.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
