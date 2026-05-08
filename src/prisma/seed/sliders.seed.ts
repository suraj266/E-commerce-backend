/**
 * =============================================================================
 * Sliders seeder
 * =============================================================================
 *
 * Idempotent: creates the `home-hero` starter slider with 2 placeholder
 * slides if it doesn't exist. Re-running never overwrites admin edits.
 * Soft-deleted sliders with the same key are revived.
 *
 * Run:
 *   pnpm seed:sliders      (compiled)
 *   pnpm seed:sliders:dev  (ts-node)
 *
 * Inside Docker:
 *   docker exec ecommerce_backend_dev pnpm seed:sliders
 * =============================================================================
 */

import { PrismaClient, SliderStatus } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedSlide {
  title: string;
  description?: string;
  link?: string;
  ctaLabel?: string;
  imageUrl?: string;
  order: number;
}

interface SeedSlider {
  key: string;
  name: string;
  description?: string;
  status: SliderStatus;
  config: object;
  slides: SeedSlide[];
}

const seeds: SeedSlider[] = [
  {
    key: 'home-hero',
    name: 'Home hero slider',
    description: 'Main carousel on the storefront homepage.',
    status: SliderStatus.PUBLISHED,
    config: { autoplayMs: 5000, style: 'full-width' },
    slides: [
      {
        title: 'The New Standard of Living',
        description:
          'Elevate your space with our curated collection of premium furniture and decor.',
        link: '/products',
        ctaLabel: 'Shop Now',
        order: 0,
      },
      {
        title: 'Hand-picked from verified sellers',
        description:
          'Quality you can trust, delivered fast across India.',
        link: '/categories',
        ctaLabel: 'Browse Categories',
        order: 1,
      },
    ],
  },
];

async function main() {
  let created = 0;
  let revived = 0;
  let slidesCreated = 0;

  for (const seed of seeds) {
    const existing = await prisma.slider.findUnique({
      where: { key: seed.key },
    });

    if (existing && existing.deletedAt !== null) {
      // Revive only — never overwrite admin edits to active rows.
      await prisma.slider.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          status: seed.status,
        },
      });
      revived += 1;
      continue;
    }

    if (existing) {
      // Already active — leave it alone.
      continue;
    }

    // Create slider + slides in one transaction.
    await prisma.$transaction(async (tx) => {
      const slider = await tx.slider.create({
        data: {
          key: seed.key,
          name: seed.name,
          description: seed.description,
          status: seed.status,
          config: seed.config,
        },
      });
      for (const s of seed.slides) {
        await tx.slideItem.create({
          data: {
            sliderId: slider.id,
            title: s.title,
            description: s.description,
            link: s.link,
            ctaLabel: s.ctaLabel,
            imageUrl: s.imageUrl,
            order: s.order,
            isEnabled: true,
          },
        });
        slidesCreated += 1;
      }
    });
    created += 1;
  }

  console.log(
    `[sliders.seed] Done. created=${created} revived=${revived} slidesCreated=${slidesCreated}`,
  );
}

main()
  .catch((e) => {
    console.error('[sliders.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
