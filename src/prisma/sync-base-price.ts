import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  console.log('Starting basePrice sync for all products...');

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  console.log(`Found ${products.length} products to sync.`);

  for (const product of products) {
    const variants = await prisma.productVariant.findMany({
      where: { productId: product.id, deletedAt: null },
      select: { price: true },
    });

    if (variants.length > 0) {
      const minPrice = Math.min(...variants.map((v) => Number(v.price)));
      await prisma.product.update({
        where: { id: product.id },
        data: { basePrice: minPrice },
      });
      console.log(`Synced product ${product.id}: basePrice = ${minPrice}`);
    } else {
      console.log(`Skipped product ${product.id}: no variants found.`);
    }
  }

  console.log('Sync complete.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
