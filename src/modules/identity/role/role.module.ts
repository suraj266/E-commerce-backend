import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RoleService } from './role.service';
import { RoleResolver } from './role.resolver';
import { RoleController } from './role.controller';

@Module({
  // JwtModule provides JwtService so RoleController can verify the refreshToken
  // cookie (secret is passed explicitly at verify()-time, so no signing config
  // is needed here).
  imports: [JwtModule.register({})],
  controllers: [RoleController],
  providers: [RoleResolver, RoleService],
})
export class RoleModule {}
