import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GqlExecutionContext } from '@nestjs/graphql';

/**
 * Like `JwtAuthGuard`, but NEVER rejects: a valid Bearer token populates
 * `req.user`; a missing/invalid token simply leaves it undefined. Used by
 * `validateCart`, which must serve both signed-in customers (validate their
 * cart) and guests (validate the cookie-scoped cart) from one endpoint.
 *
 * Reuses the already-registered passport 'jwt' strategy — no new strategy.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  getRequest(context: ExecutionContext) {
    const contextType = context.getType<string>();
    if (contextType === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      return ctx.getContext().req;
    }
    return context.switchToHttp().getRequest();
  }

  // Swallow the "no/invalid token" error passport would otherwise throw and
  // return whatever user was resolved (possibly undefined) so the request
  // proceeds unauthenticated.
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return user || (undefined as TUser);
  }
}
