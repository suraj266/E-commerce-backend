/**
 * =============================================================================
 * Demo-data seeder
 * =============================================================================
 *
 * Seeds a complete, storefront-visible demo dataset:
 *   1 brand · 1 VERIFIED seller (+user) · 1 ACTIVE store · 1 default warehouse
 *   6 ACTIVE simple products (variant + 1 image + 100 stocked units each)
 *   1 customer (+user + default Maharashtra address)
 *
 * Idempotent: re-running upserts on natural keys (User.email, Seller.userId,
 * Store.slug, Brand.name, Product.slug, ProductVariant.sku) and on the
 * Inventory [variantId, warehouseId] composite. UserAddress has no natural
 * unique key, so it is guarded with findFirst-before-create.
 *
 * Prerequisites (FAIL-FAST if missing):
 *   - Roles 'seller' and 'customer'   -> run:  pnpm seed:roles
 *   - At least one Tax row (GST 18%)   -> run:  pnpm seed:taxes
 *
 * Place-of-supply: seller/store state = Maharashtra ("27"), customer address
 * state = "Maharashtra" -> INTRA-state order (CGST + SGST). Change the address
 * state to any other state to exercise the IGST path.
 *
 * Run:  pnpm seed:demo  (ts-node)   |   pnpm seed:demo:prod  (compiled)
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';

const prisma = new PrismaClient();

const DEMO = {
  sellerEmail: 'seller@demo.test',
  sellerPassword: 'Seller@123',
  sellerPhone: '+919800000001',
  sellerBusinessEmail: 'business@demo.test',
  sellerBusinessPhone: '+919800000002',
  customerEmail: 'customer@demo.test',
  customerPassword: 'Customer@123',
  customerAddressPhone: '+919800000003',
  storeSlug: 'demo-store',
  brandName: 'DemoBrand',
  warehouseCode: 'WH-DEMO-01',
  stateCode: '27',
  stateName: 'Maharashtra',
  panNumber: 'ABCDE1234F',
  gstin: '27ABCDE1234F1Z5', // 27-prefix must match stateCode "27"
} as const;

interface DemoProduct {
  name: string;
  slug: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  hsnCode: string;
  shortDescription: string;
  description: string;
  categorySlug: string | null; // null -> first available leaf, or no category
  imageSeed: string;
}

// 6 products across price points.
const PRODUCTS: DemoProduct[] = [
  {
    name: 'Aurora Wireless Headphones',
    slug: 'aurora-wireless-headphones',
    sku: 'DEMO-AUR-HP-001',
    price: 2999,
    compareAtPrice: 3999,
    hsnCode: '8518',
    shortDescription: 'Over-ear Bluetooth headphones with 30h battery.',
    description:
      'Aurora delivers immersive sound with active noise cancellation, ' +
      '30-hour battery life, and plush memory-foam ear cups.',
    categorySlug: null,
    imageSeed: 'aurora-hp',
  },
  {
    name: 'Nimbus Cotton T-Shirt',
    slug: 'nimbus-cotton-t-shirt',
    sku: 'DEMO-NIM-TS-002',
    price: 599,
    compareAtPrice: 899,
    hsnCode: '6109',
    shortDescription: '100% combed cotton crew-neck tee.',
    description:
      'Breathable 180 GSM combed cotton tee with a relaxed fit and ' +
      'pre-shrunk fabric that keeps its shape wash after wash.',
    categorySlug: null,
    imageSeed: 'nimbus-tee',
  },
  {
    name: 'Terra Stainless Water Bottle',
    slug: 'terra-stainless-water-bottle',
    sku: 'DEMO-TER-WB-003',
    price: 849,
    compareAtPrice: null,
    hsnCode: '9617',
    shortDescription: 'Vacuum-insulated 750ml bottle.',
    description:
      'Double-wall vacuum insulation keeps drinks cold for 24h or hot ' +
      'for 12h. Leak-proof lid, BPA-free, 750ml capacity.',
    categorySlug: null,
    imageSeed: 'terra-bottle',
  },
  {
    name: 'Lumen LED Desk Lamp',
    slug: 'lumen-led-desk-lamp',
    sku: 'DEMO-LUM-DL-004',
    price: 1499,
    compareAtPrice: 1999,
    hsnCode: '9405',
    shortDescription: 'Dimmable desk lamp with USB charging.',
    description:
      'Three color temperatures, five brightness levels, a built-in ' +
      'USB-A charging port, and a flicker-free panel that is gentle on the eyes.',
    categorySlug: null,
    imageSeed: 'lumen-lamp',
  },
  {
    name: 'Strider Running Shoes',
    slug: 'strider-running-shoes',
    sku: 'DEMO-STR-RS-005',
    price: 3499,
    compareAtPrice: 4499,
    hsnCode: '6404',
    shortDescription: 'Lightweight cushioned running shoes.',
    description:
      'Responsive foam midsole, breathable engineered mesh upper, and a ' +
      'durable rubber outsole built for daily training.',
    categorySlug: null,
    imageSeed: 'strider-shoes',
  },
  {
    name: 'Pixel Pro Mechanical Keyboard',
    slug: 'pixel-pro-mechanical-keyboard',
    sku: 'DEMO-PIX-KB-006',
    price: 5999,
    compareAtPrice: 7499,
    hsnCode: '8471',
    shortDescription: 'Hot-swappable RGB mechanical keyboard.',
    description:
      'Hot-swappable switches, per-key RGB, an aluminium top plate, and ' +
      'USB-C with onboard memory for up to four profiles.',
    categorySlug: null,
    imageSeed: 'pixel-kb',
  },
];

const STOCK_QTY = 100; // onHand & available per variant.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function imageUrl(seed: string): string {
  return `https://picsum.photos/seed/${seed}/600/600`;
}

/** Look up a role by name; fail-fast with an instructive message. */
async function getRoleOrFail(name: 'seller' | 'customer') {
  const role = await prisma.role.findUnique({ where: { name } });
  if (!role) {
    throw new Error(
      `Required role "${name}" not found. ` +
        `Run prerequisite seeds first: pnpm seed:roles && pnpm seed:taxes`,
    );
  }
  return role;
}

/** Find the GST 18% tax row; fail-fast if the tax catalog is empty. */
async function getGst18OrFail() {
  const byName = await prisma.tax.findUnique({ where: { name: 'GST 18%' } });
  if (byName) return byName;
  // Fallback: any active row whose rate is 18.
  const byRate = await prisma.tax.findFirst({
    where: { rate: 18, isActive: true, deletedAt: null },
  });
  if (byRate) return byRate;
  throw new Error(
    'No GST 18% tax found (tax catalog appears unseeded). Run: pnpm seed:taxes',
  );
}

/** Optional category — attach a real leaf if one exists, else null. */
async function findCategoryId(slug: string | null): Promise<string | null> {
  if (slug) {
    const bySlug = await prisma.category.findUnique({ where: { slug } });
    if (bySlug && !bySlug.deletedAt) return bySlug.id;
  }
  const any = await prisma.category.findFirst({
    where: { isActive: true, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return any?.id ?? null;
}

/** Idempotent brand upsert (name + slug both unique). */
async function upsertBrand() {
  return prisma.brand.upsert({
    where: { name: DEMO.brandName },
    update: {}, // preserve admin edits
    create: {
      name: DEMO.brandName,
      slug: slugify(DEMO.brandName),
      description: 'Demo brand seeded for development & QA.',
      status: 'ACTIVE',
      countryCode: 'IN',
    },
  });
}

/** Idempotent user upsert by email. Password is only hashed on create. */
async function upsertUser(o: {
  email: string;
  name: string;
  phone: string | null;
  passwordHash: string;
  roleId: string;
}) {
  return prisma.user.upsert({
    where: { email: o.email },
    update: {
      // Keep the demo account usable on re-run, but DO NOT clobber the
      // password (admin/QA may have changed it). Re-assert role/status only.
      name: o.name,
      phone: o.phone,
      roleId: o.roleId,
      status: 'active',
      emailVerifiedAt: new Date(),
    },
    create: {
      email: o.email,
      name: o.name,
      phone: o.phone,
      password: o.passwordHash,
      roleId: o.roleId,
      status: 'active',
      emailVerifiedAt: new Date(),
    },
  });
}

/** Idempotent verified seller upsert (userId is unique). */
async function upsertSeller(userId: string) {
  const now = new Date();
  return prisma.seller.upsert({
    where: { userId },
    update: {
      overallStatus: 'VERIFIED',
      stateCode: DEMO.stateCode,
      stateName: DEMO.stateName,
      panVerifiedAt: now,
      gstinVerifiedAt: now,
      bankVerifiedAt: now,
      documentsVerifiedAt: now,
    },
    create: {
      userId,
      legalName: 'Demo Seller Pvt Ltd',
      displayName: 'Demo Seller',
      businessType: 'PRIVATE_LIMITED',
      panNumber: DEMO.panNumber.toUpperCase(),
      gstin: DEMO.gstin.toUpperCase(),
      stateCode: DEMO.stateCode,
      stateName: DEMO.stateName,
      businessEmail: DEMO.sellerBusinessEmail,
      businessPhone: DEMO.sellerBusinessPhone,
      commissionRate: 10, // Decimal(5,2): Prisma accepts number
      overallStatus: 'VERIFIED',
      panVerifiedAt: now,
      gstinVerifiedAt: now,
      bankVerifiedAt: now,
      documentsVerifiedAt: now,
    },
  });
}

/** Idempotent ACTIVE store upsert (slug unique). */
async function upsertStore(sellerId: string) {
  return prisma.store.upsert({
    where: { slug: DEMO.storeSlug },
    update: { status: 'ACTIVE', sellerId },
    create: {
      sellerId,
      name: 'Demo Store',
      slug: DEMO.storeSlug,
      currencyCode: 'INR',
      stateCode: DEMO.stateCode,
      stateName: DEMO.stateName,
      status: 'ACTIVE',
    },
  });
}

/** Idempotent default warehouse (guard on @@unique([storeId, code])). */
async function upsertWarehouse(storeId: string) {
  return prisma.warehouse.upsert({
    where: { storeId_code: { storeId, code: DEMO.warehouseCode } },
    update: { isDefault: true, isActive: true },
    create: {
      storeId,
      name: 'Demo Default Warehouse',
      code: DEMO.warehouseCode,
      addressLine1: '12 Industrial Estate Rd',
      city: 'Mumbai',
      state: DEMO.stateName,
      postalCode: '400001',
      countryCode: 'IN',
      isDefault: true,
      isActive: true,
    },
  });
}

/** UserAddress has no natural unique key — guard with findFirst. */
async function ensureCustomerAddress(userId: string) {
  const existing = await prisma.userAddress.findFirst({
    where: { userId, isDefault: true },
  });
  if (existing) return existing;
  return prisma.userAddress.create({
    data: {
      userId,
      type: 'both',
      firstName: 'Demo',
      lastName: 'Customer',
      phone: DEMO.customerAddressPhone,
      addressLine1: '45 MG Road',
      city: 'Pune',
      // Free-text state; the place-of-supply util resolves "Maharashtra" ->
      // code 27 -> intra-state. Change to e.g. "Karnataka" to exercise IGST.
      state: DEMO.stateName,
      postalCode: '411001',
      countryCode: 'IN',
      isDefault: true,
    },
  });
}

/**
 * Create (or refresh) one purchasable SIMPLE product:
 *   Product (ACTIVE) + 1 ProductImage + 1 ProductVariant + stocked Inventory.
 * basePrice mirrors the variant price (cached lowest-price field).
 */
async function createProductWithStock(
  p: DemoProduct,
  ctx: { storeId: string; brandId: string; taxId: string; warehouseId: string },
) {
  const categoryId = await findCategoryId(p.categorySlug);

  // 1) Product — upsert by slug.
  const product = await prisma.product.upsert({
    where: { slug: p.slug },
    update: {
      status: 'ACTIVE',
      storeId: ctx.storeId,
      brandId: ctx.brandId,
      taxId: ctx.taxId,
      categoryId,
      basePrice: p.price,
      deletedAt: null,
    },
    create: {
      storeId: ctx.storeId,
      categoryId,
      brandId: ctx.brandId,
      taxId: ctx.taxId,
      name: p.name,
      slug: p.slug,
      shortDescription: p.shortDescription,
      description: p.description,
      productType: 'SIMPLE',
      status: 'ACTIVE',
      hsnCode: p.hsnCode,
      countryOfOrigin: 'IN',
      isPriceTaxInclusive: true,
      basePrice: p.price,
      seoKeywords: [p.name.split(' ')[0].toLowerCase(), 'demo'],
      specifications: [],
    },
  });

  // 2) Image — at least one required for an ACTIVE product. Guard by count.
  if ((await prisma.productImage.count({ where: { productId: product.id } })) === 0) {
    await prisma.productImage.create({
      data: {
        productId: product.id,
        imageUrl: imageUrl(p.imageSeed),
        altText: p.name,
        displayOrder: 0,
        isPrimary: true,
      },
    });
  }

  // 3) Variant — upsert by sku (unique). For a SIMPLE product, one variant.
  const variant = await prisma.productVariant.upsert({
    where: { sku: p.sku },
    update: {
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      status: 'ACTIVE',
      productId: product.id,
      deletedAt: null,
    },
    create: {
      productId: product.id,
      sku: p.sku,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      status: 'ACTIVE',
    },
  });

  // 4) Inventory — write quantities DIRECTLY so the product is purchasable.
  //    quantityAvailable = onHand - reserved must be > 0.
  await prisma.inventory.upsert({
    where: {
      variantId_warehouseId: {
        variantId: variant.id,
        warehouseId: ctx.warehouseId,
      },
    },
    update: {
      quantityOnHand: STOCK_QTY,
      quantityReserved: 0,
      quantityAvailable: STOCK_QTY,
      deletedAt: null,
    },
    create: {
      variantId: variant.id,
      warehouseId: ctx.warehouseId,
      quantityOnHand: STOCK_QTY,
      quantityReserved: 0,
      quantityAvailable: STOCK_QTY,
      reorderPoint: 10,
    },
  });

  // 5) Movement audit row — only on first stock-in (avoid duplicate ledger
  //    entries on re-run). All required Int fields supplied.
  const inv = await prisma.inventory.findUniqueOrThrow({
    where: {
      variantId_warehouseId: {
        variantId: variant.id,
        warehouseId: ctx.warehouseId,
      },
    },
  });
  if ((await prisma.inventoryMovement.count({ where: { inventoryId: inv.id } })) === 0) {
    await prisma.inventoryMovement.create({
      data: {
        inventoryId: inv.id,
        variantId: variant.id,
        warehouseId: ctx.warehouseId,
        movementType: 'purchase', // lowercase per schema comment
        quantityChange: STOCK_QTY,
        quantityBefore: 0,
        quantityAfter: STOCK_QTY,
        referenceType: 'seed',
        notes: 'Demo seed stock-in',
      },
    });
  }

  return product;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main() {
  console.log('[demoData.seed] Starting demo data seed...');

  // FAIL-FAST prerequisite checks.
  const [sellerRole, customerRole] = await Promise.all([
    getRoleOrFail('seller'),
    getRoleOrFail('customer'),
  ]);
  const tax = await getGst18OrFail();

  // Brand.
  const brand = await upsertBrand();

  // Seller (user + verified seller + store + warehouse).
  const sellerUser = await upsertUser({
    email: DEMO.sellerEmail,
    name: 'Demo Seller',
    phone: DEMO.sellerPhone,
    passwordHash: await hash(DEMO.sellerPassword),
    roleId: sellerRole.id,
  });
  const seller = await upsertSeller(sellerUser.id);
  const store = await upsertStore(seller.id);
  const warehouse = await upsertWarehouse(store.id);

  // Products.
  const ctx = {
    storeId: store.id,
    brandId: brand.id,
    taxId: tax.id,
    warehouseId: warehouse.id,
  };
  for (const p of PRODUCTS) {
    await createProductWithStock(p, ctx);
  }

  // Customer (user + customer extension + default address).
  const customerUser = await prisma.user.upsert({
    where: { email: DEMO.customerEmail },
    update: {
      name: 'Demo Customer',
      roleId: customerRole.id,
      status: 'active',
      emailVerifiedAt: new Date(),
      Customer: { upsert: { update: {}, create: {} } },
    },
    create: {
      email: DEMO.customerEmail,
      name: 'Demo Customer',
      password: await hash(DEMO.customerPassword),
      roleId: customerRole.id,
      status: 'active',
      emailVerifiedAt: new Date(),
      Customer: { create: {} },
    },
  });
  await ensureCustomerAddress(customerUser.id);

  // Summary.
  const frontend = process.env.FRONTEND_URL ?? 'http://localhost:3000';
  console.log('\n[demoData.seed] Done. Demo dataset ready.\n');
  console.log('  Brand:     %s', brand.name);
  console.log('  Store:     %s (/%s) [ACTIVE]', store.name, store.slug);
  console.log('  Warehouse: %s [%s]', warehouse.name, warehouse.code);
  console.log('  Products:  %d ACTIVE, %d units each\n', PRODUCTS.length, STOCK_QTY);
  console.log('  --- Login credentials ---');
  console.log('  Seller   : %s / %s', DEMO.sellerEmail, DEMO.sellerPassword);
  console.log('  Customer : %s / %s', DEMO.customerEmail, DEMO.customerPassword);
  console.log('  Admin    : admin@example.com / Admin@123 (from seed:roles)\n');
  console.log('  --- URLs ---');
  console.log('  Storefront : %s', frontend);
  PRODUCTS.forEach((p) =>
    console.log('    Product  : %s/product/%s', frontend, p.slug),
  );
  console.log('  Admin panel: %s/admin', frontend);
  console.log(
    '\n  Place-of-supply: seller & customer both in Maharashtra (27) -> ' +
      'intra-state (CGST+SGST). Change the customer address state to trigger IGST.',
  );
}

main()
  .catch((e) => {
    console.error('[demoData.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
