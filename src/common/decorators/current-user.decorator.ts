import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

export interface CurrentUserPayload {
  userId: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): CurrentUserPayload | undefined => {
    const type = context.getType<string>();
    if (type === 'graphql') {
      const ctx = GqlExecutionContext.create(context);
      return ctx.getContext().req?.user;
    }
    return context.switchToHttp().getRequest().user;
  },
);
