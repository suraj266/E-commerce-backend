import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let prisma: DeepMockProxy<PrismaService>;

  const ACTOR = 'actor-1';
  const TARGET = 'target-1';

  beforeEach(() => {
    prisma = mockDeep<PrismaService>();
    service = new UserService(prisma as unknown as PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('setUserStatus (review #3 hardening)', () => {
    it('rejects a status outside the admin-settable whitelist (e.g. the DPDP "anonymized" sentinel)', async () => {
      await expect(
        service.setUserStatus(ACTOR, TARGET, 'anonymized'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.setUserStatus(ACTOR, TARGET, 'whatever'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to change your own account status', async () => {
      await expect(
        service.setUserStatus(ACTOR, ACTOR, 'banned'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('forbids a non-superAdmin from changing a superAdmin account', async () => {
      prisma.user.findUnique
        // target lookup → superAdmin
        .mockResolvedValueOnce({
          id: TARGET,
          role: { name: 'superAdmin' },
        } as never)
        // actor lookup → not superAdmin
        .mockResolvedValueOnce({ role: { name: 'seller' } } as never);

      await expect(
        service.setUserStatus(ACTOR, TARGET, 'banned'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('applies a valid status to a normal target', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: TARGET,
        role: { name: 'seller' },
      } as never);
      prisma.user.update.mockResolvedValue({ id: TARGET } as never);

      await service.setUserStatus(ACTOR, TARGET, 'suspended');

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET },
          data: { status: 'suspended' },
        }),
      );
    });
  });
});
