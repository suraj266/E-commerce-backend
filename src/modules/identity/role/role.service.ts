import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateRoleInput } from './dto/create-role.input';
import { UpdateRoleInput } from './dto/update-role.input';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditService } from '@/modules/observability/audit/audit.service';

/**
 * Shape a raw Permission row into the GraphQL `Permission` object by deriving
 * the convenience `slug` (`module:action`) — there is no `slug` column; it is
 * computed the same way PermissionsGuard builds the strings it matches against.
 */
function toPermission<T extends { module: string; action: string }>(p: T) {
  return { ...p, slug: `${p.module}:${p.action}` };
}

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    // @Global AuditService (P3-05). Optional so this service constructs without
    // it in isolated contexts; Nest always injects it in the running app.
    private readonly audit?: AuditService,
  ) { }
  create(createRoleInput: CreateRoleInput) {
    return this.prisma.role.create({ data: createRoleInput })
  }

  /**
   * All roles, each hydrated with its granted permissions (mapped off the
   * RolePermission join). Drives the admin role-matrix (P3-06).
   */
  async findAll() {
    const roles = await this.prisma.role.findMany({
      include: { permission: { include: { permission: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return roles.map((role) => ({
      ...role,
      permissions: role.permission.map((rp) => toPermission(rp.permission)),
    }));
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permission: { include: { permission: true } } },
    });
    if (!role) return null;
    return {
      ...role,
      permissions: role.permission.map((rp) => toPermission(rp.permission)),
    };
  }

  update(id: string, updateRoleInput: UpdateRoleInput) {
    return this.prisma.role.update({ where: { id }, data: updateRoleInput });
  }

  remove(id: string) {
    return this.prisma.role.delete({ where: { id } });
  }

  /**
   * The read-only permission catalog — every atomic capability seeded in
   * rolePermission.seed.ts, sorted for a stable matrix column order. Feeds the
   * admin role-matrix columns (P3-06).
   */
  async findAllPermissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
    return permissions.map(toPermission);
  }

  /**
   * Grant `permissionId` to `roleId`. Idempotent: re-assigning an already-held
   * permission is a no-op (upsert on the composite unique). Records who granted
   * it. Returns the role re-hydrated with its full permission set so the matrix
   * UI can update a whole row from one mutation payload.
   */
  async assignPermission(
    roleId: string,
    permissionId: string,
    actorUserId?: string,
  ) {
    const [role, permission] = await Promise.all([
      this.prisma.role.findUnique({ where: { id: roleId } }),
      this.prisma.permission.findUnique({ where: { id: permissionId } }),
    ]);
    if (!role) throw new NotFoundException(`Role ${roleId} not found`);
    if (!permission) {
      throw new NotFoundException(`Permission ${permissionId} not found`);
    }

    // Delegation boundary (review #3): you may only grant a permission you
    // yourself already hold. This stops a holder of `permission:update` from
    // escalating their own (or any) role beyond their own capabilities.
    // superAdmin holds every slug, so legitimate admin delegation is unaffected.
    await this.assertActorHoldsPermission(actorUserId, permission);

    await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: { assignedById: actorUserId ?? undefined, revokedById: null },
      create: { roleId, permissionId, assignedById: actorUserId ?? undefined },
    });

    // Append-only forensic trail for the platform's highest-privilege op (review #7).
    await this.audit?.record({
      action: 'role.permission_granted',
      entityType: 'Role',
      entityId: roleId,
      actorUserId: actorUserId ?? null,
      after: { permission: `${permission.module}:${permission.action}` },
    });

    return this.findOne(roleId);
  }

  /**
   * Revoke `permissionId` from `roleId`. Idempotent: revoking a permission the
   * role doesn't hold is a harmless no-op (deleteMany matches zero rows).
   * Returns the role re-hydrated with its remaining permissions.
   */
  async revokePermission(
    roleId: string,
    permissionId: string,
    actorUserId?: string,
  ) {
    const [role, permission] = await Promise.all([
      this.prisma.role.findUnique({ where: { id: roleId } }),
      this.prisma.permission.findUnique({ where: { id: permissionId } }),
    ]);
    if (!role) throw new NotFoundException(`Role ${roleId} not found`);
    if (!permission) {
      throw new NotFoundException(`Permission ${permissionId} not found`);
    }

    // Same delegation boundary as grant: only act on a permission you hold.
    await this.assertActorHoldsPermission(actorUserId, permission);

    await this.prisma.rolePermission.deleteMany({
      where: { roleId, permissionId },
    });

    await this.audit?.record({
      action: 'role.permission_revoked',
      entityType: 'Role',
      entityId: roleId,
      actorUserId: actorUserId ?? null,
      before: { permission: `${permission.module}:${permission.action}` },
    });

    return this.findOne(roleId);
  }

  /**
   * Grant-only-what-you-hold guard: the acting principal must already hold the
   * exact `module:action` slug being granted/revoked. Denies when the actor is
   * unknown (no delegation authority can be established).
   */
  private async assertActorHoldsPermission(
    actorUserId: string | undefined,
    permission: { module: string; action: string },
  ): Promise<void> {
    const slug = `${permission.module}:${permission.action}`;
    if (!actorUserId) {
      throw new ForbiddenException(
        'Cannot change permissions without an authenticated actor.',
      );
    }
    const held = await this.getUserPermissionSlugs(actorUserId);
    if (!held.includes(slug)) {
      throw new ForbiddenException(
        `You cannot delegate a permission you do not hold (${slug}).`,
      );
    }
  }

  /**
   * Every permission slug (`module:action`) granted to a user's role. Powers
   * the P3-06 per-permission route gate: the GraphQL `myPermissions` query
   * (client-side hidden nav) and the REST `GET /roles/me/permissions` endpoint
   * (server-side gate). Mirrors exactly how PermissionsGuard derives the slugs
   * it enforces, so the UI and the guard never disagree.
   */
  async getUserPermissionSlugs(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: { include: { permission: { include: { permission: true } } } },
      },
    });
    if (!user?.role) return [];
    return user.role.permission.map(
      (rp) => `${rp.permission.module}:${rp.permission.action}`,
    );
  }
}
