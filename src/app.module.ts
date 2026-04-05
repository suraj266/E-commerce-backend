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
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: GqlThrottlerGuard }],
})
export class AppModule { }

