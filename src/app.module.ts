import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { RequestContextMiddleware } from "./common/context/request-context";
import { SentryShutdownService } from "./common/observability/sentry-shutdown.service";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { UserModule } from './modules/identity/user/user.module';
import { PrismaModule } from "./prisma/prisma.module";
import { LibsModule } from "./libs/libs.module";
import { AuthModule } from './modules/identity/auth/auth.module';
import { ConfigModule } from "@nestjs/config";
import { envSchema } from "@/common/config/env.validation";
import { RoleModule } from './modules/identity/role/role.module';
import { CustomerModule } from './modules/identity/customer/customer.module';
import { AddressModule } from './modules/identity/address/address.module';
import { ApiKeyModule } from './modules/identity/apikey/apikey.module';
import { ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
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
import { WishlistModule } from './modules/ecommerce/wishlist/wishlist.module';
import { CartModule } from './modules/ecommerce/cart/cart.module';
import { OrderModule } from './modules/ecommerce/order/order.module';
import { PaymentModule } from './modules/ecommerce/payment/payment.module';
import { PayoutModule } from './modules/ecommerce/payout/payout.module';
import { CouponModule } from './modules/ecommerce/coupon/coupon.module';
import { ReviewModule } from './modules/ecommerce/review/review.module';
import { InvoiceModule } from './modules/ecommerce/invoice/invoice.module';
import { CatalogStatsModule } from './modules/ecommerce/catalog-stats/catalog-stats.module';
import { LabelModule } from './modules/ecommerce/label/label.module';
import { CollectionModule } from './modules/ecommerce/collection/collection.module';
import { ShippingModule } from './modules/ecommerce/shipping/shipping.module';
import { CourierModule } from './modules/ecommerce/courier/courier.module';
import { ReturnsModule } from './modules/ecommerce/returns/returns.module';
// CMS modules
import { PageModule } from './modules/cms/page/page.module';
import { MenuModule } from './modules/cms/menu/menu.module';
import { SliderModule } from './modules/cms/slider/slider.module';
import { NewsletterModule } from './modules/cms/newsletter/newsletter.module';
// Media modules
import { ImageModule } from './modules/media/image/image.module';
// Admin modules
import { AdminThemeModule } from './modules/admin/admin-theme/admin-theme.module';
import { SiteSettingModule } from './modules/admin/site-setting/site-setting.module';
import { EmailModule } from './modules/admin/email/email.module';
import { DashboardModule } from './modules/admin/dashboard/dashboard.module';
// Infra modules
import { OutboxModule } from './modules/outbox/outbox.module';
// Observability modules
import { AuditModule } from './modules/observability/audit/audit.module';
import { AuditInterceptor } from './modules/observability/audit/audit.interceptor';
import { NotificationModule } from './modules/notification/notification.module';
import { MetricsModule } from './modules/observability/metrics/metrics.module';
import { HttpMetricsInterceptor } from './modules/observability/metrics/http-metrics.interceptor';
// Compliance modules
import { PrivacyModule } from './modules/compliance/privacy/privacy.module';
import { TcsModule } from './modules/compliance/tcs/tcs.module';


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
    ScheduleModule.forRoot(),
    RoleModule,
    CustomerModule,
    AddressModule,
    // Programmatic API keys for sellers/admins (Phase 3, Wave 4). Mint (returns
    // the plaintext once) / list / revoke / verify; ApiKeyGuard authenticates an
    // inbound `Authorization: Bearer sk_...` for future M2M surfaces.
    ApiKeyModule,
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
    WishlistModule,
    CartModule,
    OrderModule,
    PaymentModule,
    PayoutModule,
    CouponModule,
    ReviewModule,
    InvoiceModule,
    CatalogStatsModule,
    LabelModule,
    CollectionModule,
    ShippingModule,
    CourierModule,
    // Returns / RMA lifecycle (P3-02): reverse-pickup + reuse of the guarded
    // refund + carry-forward payout clawback + §52 TCS reversal.
    ReturnsModule,
    // ---- CMS Modules ----
    PageModule,
    MenuModule,
    SliderModule,
    NewsletterModule,
    // ---- Media Modules ----
    ImageModule,
    // ---- Admin Modules ----
    AdminThemeModule,
    SiteSettingModule,
    EmailModule,
    DashboardModule,
    // ---- Infra Modules ----
    // In-app notification bell (P3-08). @Global, so the outbox worker handlers +
    // the domain services that own the lifecycle-email senders inject
    // NotificationService to write a bell entry alongside each email without
    // extra module wiring. Registered before OutboxModule so it is in the graph
    // when the worker handlers resolve it.
    NotificationModule,
    // Durable transactional outbox (P3-01). Registered last; it imports the
    // domain modules whose services its workers call. OutboxCoreModule
    // (OutboxService, @Global) is pulled in transitively for the enqueuers.
    OutboxModule,
    // ---- Observability Modules ----
    // Append-only security audit log (P3-05). @Global, so the money-mover
    // services inject AuditService without extra module wiring.
    AuditModule,
    // Prometheus metrics (P3-04). @Global (exposes MetricsService for future
    // domain increments) + mounts the secured GET /metrics endpoint and the
    // default Node/runtime metrics. The HTTP-duration interceptor is registered
    // as an APP_INTERCEPTOR below; the Prisma query-timing extension is composed
    // inside PrismaService.
    MetricsModule,
    // ---- Compliance Modules ----
    // DPDP Act 2023 (P3-07): erasure-as-anonymization, data export, consent.
    PrivacyModule,
    // TCS §52 marketplace tax (P3-03). @Global, so the money-mover services
    // (payment/refund/payout/seller-order) inject TcsService without importing
    // it. Accrual/reversal/netting; GSTR-8/GSTR-1 export. NEEDS CA SIGN-OFF.
    TcsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SentryShutdownService,
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    // Global audit interceptor (P3-05) — inert unless a handler carries @Audit.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Global HTTP-duration interceptor (P3-04) — observes
    // http_request_duration_seconds once per request (dedupes GraphQL fan-out).
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
})
export class AppModule implements NestModule {
  // Registered here (in the root module) so it binds AFTER nestjs-pino's own
  // request middleware — that ordering guarantees `req.id` (set by pino's
  // genReqId) already exists when RequestContextMiddleware seeds it into the
  // AsyncLocalStorage as the correlation id.
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

