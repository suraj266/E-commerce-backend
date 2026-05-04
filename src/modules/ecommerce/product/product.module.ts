import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductResolver } from './product.resolver';
import { InventoryModule } from '@/modules/ecommerce/inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  providers: [ProductResolver, ProductService],
})
export class ProductModule {}
