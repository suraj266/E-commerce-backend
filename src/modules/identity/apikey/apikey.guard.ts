/**
 * ApiKeyGuard — authenticates an inbound programmatic API key.
 *
 * Reads `Authorization: Bearer sk_...` (HTTP or GraphQL context), verifies it
 * via ApiKeyService.verify() — unique-prefix lookup + constant-time hash compare
 * + revoke/expiry checks, which also bumps `lastUsedAt` — and, on success,
 * attaches the authenticated key to the request as `req.apiKey`. Throws
 * UnauthorizedException on any failure (malformed, unknown, revoked, expired,
 * or hash mismatch — all indistinguishable to the caller).
 *
 * NOT retrofitted onto existing endpoints this wave — it is provided for future
 * machine-to-machine surfaces (see the "attach points" note in the module).
 * Scope enforcement is left to the endpoint (read `req.apiKey.scopes`); this
 * guard only proves the key is valid.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';
import { ApiKeyService } from './apikey.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = this.getRequest(context);
    const presented = this.extractBearer(req);
    if (!presented) {
      throw new UnauthorizedException('Missing API key.');
    }

    const apiKey = await this.apiKeys.verify(presented);
    if (!apiKey) {
      throw new UnauthorizedException('Invalid or expired API key.');
    }

    // Attach for downstream handlers (scope checks, owner attribution).
    (req as Request & { apiKey?: unknown }).apiKey = apiKey;
    return true;
  }

  private getRequest(context: ExecutionContext): Request {
    if (context.getType<string>() === 'graphql') {
      return GqlExecutionContext.create(context).getContext().req;
    }
    return context.switchToHttp().getRequest<Request>();
  }

  private extractBearer(req: Request | undefined): string | null {
    const header = req?.headers?.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (!token || scheme.toLowerCase() !== 'bearer') return null;
    return token.trim();
  }
}
