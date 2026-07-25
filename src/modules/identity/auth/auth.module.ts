import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './passport_strategy/jwt.strategy';
import { config } from '@/common/config/config';
import { AuthController } from './auth.controller';
import { EmailModule } from '@/modules/admin/email/email.module';
import { CartModule } from '@/modules/ecommerce/cart/cart.module';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: config.JWT_SECRET,
      signOptions: {
        expiresIn: config.JWT_EXPIRES_IN,
        algorithm: config.JWT_ALGORITHM,
      },
    }),
    EmailModule,
    CartModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy]
})
export class AuthModule { }
