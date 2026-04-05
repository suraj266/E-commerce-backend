import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/permissions.decorator";
import { GqlExecutionContext } from "@nestjs/graphql";
import { PrismaService } from "@/prisma/prisma.service";

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!requiredPermissions) {
            return true;
        }
        const user = GqlExecutionContext.create(context).getContext().req.user;
        if (!user) {
            throw new UnauthorizedException;
        }

        const userWithPermissions = await this.prisma.user.findUnique({
            where: {
                id: user.userId,
            },
            include: {
                role: {
                    include: {
                        permission: {
                            include: {
                                permission: true
                            }
                        },
                    }
                }
            }
        });

        if (!userWithPermissions?.role) {
            throw new ForbiddenException;
        }

        const userPermissions: string[] | undefined = userWithPermissions?.role?.permission.map((item: any) => item.permission.module + ":" + item.permission.action);

        if (!userPermissions) {
            throw new ForbiddenException;
        }

        return requiredPermissions.some((permission: string) => userPermissions?.includes(permission));
    }
}