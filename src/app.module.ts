import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { UserModule } from './modules/identity/user/user.module';
import { PrismaModule } from "./prisma/prisma.module";
import { LibsModule } from "./libs/libs.module";
import { AuthModule } from './modules/identity/auth/auth.module';
import { ConfigModule } from "@nestjs/config";
import { envSchema } from "@/common/config/env.validation";
import { RoleModule } from './modules/identity/role/role.module';
import { ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { GqlThrottlerGuard } from "./libs/gqlThtottlerGuard.module";
import { HealthModule } from "./modules/health/health.module";
// Ecommerce modules
import { CategoryModule } from './modules/ecommerce/category/category.module';
import { SellerModule } from './modules/ecommerce/seller/seller.module';
import { StoreModule } from './modules/ecommerce/store/store.module';
import { BrandModule } from './modules/ecommerce/brand/brand.module';
import { TagModule } from './modules/ecommerce/tag/tag.module';
import { AttributeModule } from './modules/ecommerce/attribute/attribute.module';
import { ProductModule } from './modules/ecommerce/product/product.module';
import { InventoryModule } from './modules/ecommerce/inventory/inventory.module';
import { TaxModule } from './modules/ecommerce/tax/tax.module';
// Media modules
import { ImageModule } from './modules/media/image/image.module';
// Admin modules
import { AdminThemeModule } from './modules/admin/admin-theme/admin-theme.module';


@Module({
  imports: [
    PrismaModule,
    LibsModule,
    UserModule,
    AuthModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: envSchema,
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 5000,
          limit: 50,
        },
      ],
    }),
    RoleModule,
    HealthModule,
    // ---- Ecommerce Modules ----
    CategoryModule,
    SellerModule,
    StoreModule,
    BrandModule,
    TagModule,
    AttributeModule,
    ProductModule,
    InventoryModule,
    TaxModule,
    // ---- Media Modules ----
    ImageModule,
    // ---- Admin Modules ----
    AdminThemeModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: GqlThrottlerGuard }],
})
export class AppModule { }

