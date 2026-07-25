import {
  Controller,
  Get,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { config } from '@/common/config/config';
import { RoleService } from './role.service';

/**
 * RoleController — the REST half of the P3-06 per-permission route gate.
 *
 * The GraphQL API authenticates with a Bearer access token, which Next.js
 * Server Components don't hold. So the frontend's server-side gate
 * (`getServerPermissions`) needs a cookie-authenticated endpoint, exactly like
 * AuthProxy leans on `GET /auth/session`. This resolves the caller's permission
 * slugs from the httpOnly refreshToken cookie WITHOUT rotating it (a read-only
 * verify, mirroring AuthService.getSession), so it is safe to call on every
 * protected page render.
 *
 * This is defense-in-depth: the authoritative per-permission enforcement still
 * lives on every resolver via PermissionsGuard. This endpoint only lets the
 * frontend render an honest "no access" page instead of firing doomed queries.
 */
@Controller('roles')
export class RoleController {
  constructor(
    private readonly jwtService: JwtService,
    private readonly roleService: RoleService,
  ) {}

  /** GET /roles/me/permissions — caller's permission slugs resolved from the refreshToken cookie (read-only, no rotation). Public (cookie-authenticated). */
  @Get('me/permissions')
  async myPermissions(
    @Req() req: Request,
  ): Promise<{ permissions: string[] }> {
    const refreshToken = (req as Request & { cookies?: Record<string, string> })
      .cookies?.refreshToken;
    if (!refreshToken) throw new UnauthorizedException('No session');

    let payload: { sub: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: config.REFRESH_TOKEN_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid session');
    }

    const permissions = await this.roleService.getUserPermissionSlugs(
      payload.sub,
    );
    return { permissions };
  }
}
