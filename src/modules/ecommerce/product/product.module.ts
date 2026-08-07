import { Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductResolver } from './product.resolver';
import { InventoryModule } from '@/modules/ecommerce/inventory/inventory.module';
import { CourierModule } from '@/modules/ecommerce/courier/courier.module';

// CourierModule (exports CourierService) powers the read-only storefront
// delivery estimator (P4-B). ProductModule is a leaf in the import graph
// (only app.module imports it) and nothing in CourierModule's subtree imports
// ProductModule, so a plain import — no forwardRef — is cycle-free.
@Module({
  imports: [InventoryModule, CourierModule],
  providers: [ProductResolver, ProductService],
})
export class ProductModule {}
