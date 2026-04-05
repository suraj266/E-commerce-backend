import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { GqlExecutionContext } from "@nestjs/graphql";

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
    getRequest(context: ExecutionContext) {
        const contextType = context.getType<string>();
        if (contextType === 'graphql') {
            const ctx = GqlExecutionContext.create(context);
            return ctx.getContext().req;
        }
        // REST API context
        return context.switchToHttp().getRequest();
    }
}