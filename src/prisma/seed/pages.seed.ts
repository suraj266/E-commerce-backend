/**
 * =============================================================================
 * System pages seeder
 * =============================================================================
 *
 * Idempotent upsert of "system" pages — slugs the storefront expects to
 * always exist (home, about, terms, privacy, help). Admin can edit them
 * but the UI hides the delete button (PageService blocks delete on
 * isSystem=true).
 *
 * Each system page starts as DRAFT with empty blocks. Admin populates the
 * content via the page editor and flips status to PUBLISHED when ready.
 * Re-running this seed never overwrites admin edits to title/blocks.
 *
 * Run:
 *   pnpm seed:pages      (compiled)
 *   pnpm seed:pages:dev  (ts-node)
 *
 * Inside Docker:
 *   docker exec ecommerce_backend_dev pnpm seed:pages
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SystemPage {
  slug: string;
  title: string;
  metaTitle?: string;
  metaDesc?: string;
  /** Starter content used when the page has empty blocks. */
  starterBody?: string;
}

/**
 * Single rich-text block for the simple legal/help pages. Markdown is
 * rendered by the `rich-text` block in the page-builder. Admin can swap
 * to a richer composition later from /admin/pages.
 */
function richTextBlock(id: string, body: string) {
  return {
    id,
    type: 'rich-text',
    visible: true,
    props: { body, maxWidth: 'narrow' },
  };
}

const seeds: SystemPage[] = [
  {
    slug: 'home',
    title: 'Home',
    metaTitle: 'Welcome to our marketplace',
    metaDesc: 'Discover products from verified sellers across India.',
  },
  {
    slug: 'about',
    title: 'About Us',
    metaDesc: 'Learn more about our marketplace and mission.',
    starterBody: `# About Us

We're a marketplace built for India — connecting sellers across the country with shoppers who care about quality and provenance.

## Our mission

Make it effortless for any small business to sell online, and give shoppers a curated catalogue they can trust.

## Get in touch

Visit our [help page](/help) for support, or [become a seller](/seller/onboarding) if you'd like to list your products.`,
  },
  {
    slug: 'terms',
    title: 'Terms & Conditions',
    metaDesc: 'Terms governing the use of this marketplace.',
    starterBody: `# Terms & Conditions

_Last updated: when you publish this page from /admin/pages._

This is placeholder copy. Replace it with your real Terms of Service before going live — the placeholder isn't legally binding.

## 1. Acceptance of terms

By using this site, you agree to follow the rules below.

## 2. Account responsibility

You're responsible for keeping your password safe and for activity under your account.

## 3. Orders and payments

Order placement creates a contract between you and the seller. Payment is collected via the methods listed at checkout.

## 4. Returns

See the seller's return policy on each product page. Refunds are handled per the marketplace's refund policy.

## 5. Contact

Questions? Reach us via the [help center](/help).`,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    metaDesc: 'How we collect, use, and protect your data.',
    starterBody: `# Privacy Policy

_Last updated: when you publish this page from /admin/pages._

This is placeholder copy. Replace it with your real Privacy Policy before going live.

## What we collect

- Account information (name, email, phone)
- Shipping addresses you save
- Order history
- Cookies for cart and session

## How we use it

To process your orders, ship products to you, and contact you about your account.

## Sharing

We share order details with the sellers you buy from. We never sell your data to third parties.

## Your rights

You can request a copy of your data or ask us to delete your account at any time. Contact us via the [help center](/help).`,
  },
  {
    slug: 'help',
    title: 'Help & FAQ',
    metaDesc: 'Common questions and how to get support.',
    starterBody: `# Help & FAQ

## Orders

**Where's my order?** Open [/account/orders](/account/orders) and pick the order to see its status timeline.

**Can I cancel?** Yes, while it's still _Pending_. Once a seller has confirmed and packed it, contact support.

## Account

**Forgot my password?** Use the [reset link](/forgot-password) on the sign-in page.

**Change my email or phone?** Go to [/account/profile](/account/profile).

## Sellers

**Want to sell on the platform?** Start at [/seller/onboarding](/seller/onboarding).

## Still stuck?

Email support@example.com (replace with your real address before going live).`,
  },
];

/**
 * Starter homepage composition — applied only when the `home` page has no
 * blocks yet (fresh DB or never touched). Once the admin saves any blocks,
 * this seed will leave the page alone forever.
 *
 * Block ids are stable so multiple seed runs against an empty home page
 * are idempotent. The hero references the seeded `home-hero` slider.
 */
const HOME_STARTER_BLOCKS = [
  {
    id: 'home-hero',
    type: 'hero',
    visible: true,
    variant: 'slider',
    props: {
      sliderKey: 'home-hero',
      height: 'lg',
      autoAdvanceMs: undefined,
      // Defaults required by schema even though unused in the slider variant
      headline: '',
      subtext: '',
      ctaLabel: '',
      ctaHref: '',
      imageUrl: '',
      alignment: 'center',
      overlayOpacity: 50,
    },
  },
  {
    id: 'home-shop-by-category',
    type: 'category-showcase',
    visible: true,
    variant: 'mosaic',
    props: {
      title: 'Shop by category',
      subtitle: '',
      source: 'auto',
      maxItems: 5,
      items: [],
    },
  },
  {
    id: 'home-trending',
    type: 'featured-products',
    visible: true,
    variant: 'showcase-carousel',
    props: {
      title: 'Trending now',
      subtitle: 'Hand-picked drops our shoppers love.',
      source: 'category',
      categorySlug: '',
      brandSlug: '',
      tagSlug: '',
      productSlugs: '',
      maxItems: 8,
      layout: 'carousel',
      columns: 4,
      showBadges: true,
    },
  },
  {
    id: 'home-newsletter',
    type: 'newsletter-signup',
    visible: true,
    variant: 'centered-banner',
    props: {
      title: 'Stay in the loop',
      subtext: 'Get early access to new arrivals and exclusive offers.',
      buttonLabel: 'Subscribe',
      placeholder: 'Enter your email',
      source: 'homepage-newsletter',
      backgroundImageUrl: '',
    },
  },
];

/**
 * Resolve the starter blocks for a given seed entry. `home` gets the
 * full block composition; the legal/help pages get a single rich-text
 * block with their `starterBody` Markdown. Returns null when there's
 * nothing to seed (defensive, all current seeds either have blocks or
 * starter body).
 */
function starterBlocksFor(seed: SystemPage): unknown[] | null {
  if (seed.slug === 'home') return HOME_STARTER_BLOCKS;
  if (seed.starterBody) {
    return [richTextBlock(`${seed.slug}-body`, seed.starterBody)];
  }
  return null;
}

async function main() {
  let created = 0;
  let revived = 0;
  let composed = 0;

  for (const seed of seeds) {
    const existing = await prisma.page.findUnique({
      where: { slug: seed.slug },
    });
    const starter = starterBlocksFor(seed);

    if (!existing) {
      await prisma.page.create({
        data: {
          slug: seed.slug,
          title: seed.title,
          metaTitle: seed.metaTitle,
          metaDesc: seed.metaDesc,
          isSystem: true,
          ...(starter
            ? {
                blocks: starter as object,
                status: 'PUBLISHED' as const,
                publishedAt: new Date(),
              }
            : {}),
        },
      });
      if (starter) composed += 1;
      created += 1;
      continue;
    }

    // Idempotent: only revive if soft-deleted; never overwrite admin edits.
    if (existing.deletedAt !== null) {
      await prisma.page.update({
        where: { id: existing.id },
        data: { deletedAt: null, isSystem: true },
      });
      revived += 1;
    }

    // Compose-on-empty: if the page has no blocks yet (admin never
    // edited), drop in the starter composition + auto-publish so the
    // storefront stops showing "Page not found" for these slugs.
    if (starter) {
      const blocks = Array.isArray(existing.blocks)
        ? existing.blocks
        : (existing.blocks as unknown as unknown[] | null) ?? [];
      if (blocks.length === 0) {
        await prisma.page.update({
          where: { id: existing.id },
          data: {
            blocks: starter as object,
            status: 'PUBLISHED',
            publishedAt: existing.publishedAt ?? new Date(),
          },
        });
        composed += 1;
      }
    }
  }

  console.log(
    `[pages.seed] Done. created=${created} revived=${revived} composed=${composed}`,
  );
}

main()
  .catch((e) => {
    console.error('[pages.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
