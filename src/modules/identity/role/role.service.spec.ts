import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditService } from '@/modules/observability/audit/audit.service';
import { RoleService } from './role.service';

/**
 * RoleService permission-delegation boundary (Wave-3 review #3/#7): grant/revoke
 * must be "grant-only-what-you-hold" so `permission:update` can't self-escalate,
 * and each change must hit the append-only audit trail.
 */
describe('RoleService — permission delegation boundary', () => {
  let service: RoleService;
  let prisma: DeepMockProxy<PrismaService>;
  let audit: DeepMockProxy<AuditService>;

  const ROLE_ID = 'role-target';
  const PERM_ID = 'perm-refund-approve';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    audit = mockDeep<AuditService>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new RoleService(prisma as any, audit as any);

    prisma.role.findUnique.mockResolvedValue({
      id: ROLE_ID,
      permission: [],
    } as never);
    prisma.permission.findUnique.mockResolvedValue({
      id: PERM_ID,
      module: 'refund',
      action: 'approve',
    } as never);
  });

  /** Make getUserPermissionSlugs(actor) resolve to the given slugs. */
  function actorHolds(slugs: { module: string; action: string }[]) {
    prisma.user.findUnique.mockResolvedValue({
      role: { permission: slugs.map((permission) => ({ permission })) },
    } as never);
  }

  it('rejects granting a permission the actor does not hold (no self-escalation)', async () => {
    actorHolds([{ module: 'page', action: 'read' }]); // lacks refund:approve
    await expect(
      service.assignPermission(ROLE_ID, PERM_ID, 'actor-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it('allows granting a permission the actor already holds + audits it', async () => {
    actorHolds([
      { module: 'refund', action: 'approve' },
      { module: 'permission', action: 'update' },
    ]);
    await service.assignPermission(ROLE_ID, PERM_ID, 'actor-1');
    expect(prisma.rolePermission.upsert).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'role.permission_granted' }),
    );
  });

  it('denies a permission change with no authenticated actor', async () => {
    await expect(
      service.assignPermission(ROLE_ID, PERM_ID, undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it('revoke is subject to the same grant-only-what-you-hold boundary', async () => {
    actorHolds([{ module: 'page', action: 'read' }]); // lacks refund:approve
    await expect(
      service.revokePermission(ROLE_ID, PERM_ID, 'actor-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
  });
});
