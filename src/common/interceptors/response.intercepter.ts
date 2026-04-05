import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable, map } from "rxjs";

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> | Promise<Observable<any>> {
        const ctx = context.getType<string>();
        if (ctx === 'graphql') {
            return next.handle();
        }
        return next.handle().pipe(map(data => ({
            success: true,
            data,
            message: "OK",
            statusCode: 200,
            timestamp: new Date().toISOString()
        })));
    }
}