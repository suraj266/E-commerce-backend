import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CreateUserInput } from './dto/create-user.input';
import { UpdateUserInput } from './dto/update-user.input';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, User } from '@prisma/client';
import { hash } from 'argon2';
import {
  anonymizedEmail,
  ANONYMIZED_EMAIL_DOMAIN,
  TOMBSTONE,
} from '@/modules/compliance/privacy/privacy.constants';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * DPDP erasure scrub (P3-07) — used by PrivacyService.anonymizeUser.
   *
   * IRREVERSIBLE. Rewrites User + UserAddress PII to tombstones and SEVERS
   * LOGIN. This is deliberately narrow: it touches ONLY identity PII. It does
   * NOT delete or alter any Order / Payment / Invoice / TcsLedger row or any
   * invoice PDF — those are retained under the 7-year GST mandate, and the
   * immutable invoice PDF carries the legally-required buyer snapshot.
   *
   * What is scrubbed:
   *   - User: email → non-routable tombstone (`deleted+<id>@anonymized.invalid`,
   *     preserves the UNIQUE index), name → tombstone, phone/gender/dob/avatar
   *     → cleared, verification/login timestamps → cleared, status →
   *     'anonymized', metadata → replaced (it may itself contain PII), and the
   *     password → a hash of a random secret nobody holds. Combined with the
   *     dead tombstone email (no password-reset can be delivered), login is
   *     permanently severed.
   *   - UserAddress: fine-grained PII (names, phone, street lines, postal code)
   *     → tombstones. We intentionally KEEP the coarse geo (city / state /
   *     countryCode).
   *     👤 NEEDS LEGAL SIGN-OFF on coarse-location retention.
   *
   * IDEMPOTENT: tombstones are deterministic, so a re-run is a harmless no-op
   * (PrivacyService only calls this when the user isn't already anonymized).
   */
  async anonymizePii(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ email: string }> {
    const tombstoneEmail = anonymizedEmail(userId);
    // Unusable password: argon2 hash of a random secret. Nobody holds the
    // plaintext, and verify() against it can only ever fail.
    const severedPassword = await hash(randomBytes(32).toString('hex'));

    // Runs on the caller's tx when provided, so PrivacyService can commit the
    // scrub atomically with the erasure claim + newsletter unsubscribe; else a
    // self-contained transaction. Both writes are idempotent (deterministic
    // tombstones), so a retry is a harmless no-op.
    const scrub = async (db: Prisma.TransactionClient) => {
      await db.user.update({
        where: { id: userId },
        data: {
          email: tombstoneEmail,
          name: TOMBSTONE.NAME,
          phone: null,
          password: severedPassword,
          gender: null,
          dateOfBirth: null,
          avatarUrl: null,
          emailVerifiedAt: null,
          phoneVerifiedAt: null,
          lastLoginAt: null,
          status: 'anonymized',
          metadata: {
            anonymized: true,
            anonymizedAt: new Date().toISOString(),
          },
        },
      });
      await db.userAddress.updateMany({
        where: { userId },
        data: {
          firstName: TOMBSTONE.ADDRESS_NAME,
          lastName: TOMBSTONE.ADDRESS_NAME,
          phone: null,
          label: null,
          addressLine1: TOMBSTONE.REDACTED,
          addressLine2: null,
          postalCode: TOMBSTONE.REDACTED,
          // KEEP: city, state, countryCode (coarse geo). See doc-comment +
          // the coarse-location retention legal sign-off.
        },
      });
    };

    if (tx) await scrub(tx);
    else await this.prisma.$transaction((t) => scrub(t));

    return { email: tombstoneEmail };
  }

  /** True when the user row has already been scrubbed (tombstone email/status). */
  async isAnonymized(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true },
    });
    if (!user) return false;
    return (
      user.status === 'anonymized' ||
      user.email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`)
    );
  }

  async create(createUserInput: CreateUserInput): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email: createUserInput.email } })
    if (user) {
      throw new Error("User already exists")
    }
    const passwordHash = await hash(createUserInput.password)
    return this.prisma.user.create({ data: { ...createUserInput, password: passwordHash } })
  }

  findAll() {
    return this.prisma.user.findMany();
  }

  /**
   * Admin platform-user list — server-side pagination + filters (Phase 3
   * Wave 4). Includes the `role` relation so the console renders the role name
   * without a second round-trip. `search` matches name / email / phone
   * (case-insensitive); `status` and `roleId` are exact filters.
   */
  async adminUsers(opts: {
    search?: string;
    status?: string;
    roleId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const search = opts.search?.trim();

    const where: Prisma.UserWhereInput = {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.roleId ? { roleId: opts.roleId } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, totalCount] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { role: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  /**
   * Set a user's account status (active / inactive / suspended / banned).
   * Dedicated mutation so the admin console has an explicit, narrowly-scoped
   * action distinct from the general updateUser. Returns the fresh row with its
   * role included.
   */
  /** Admin-settable account statuses. Deliberately EXCLUDES 'anonymized' — that
   * is the DPDP erasure tombstone sentinel (isAnonymized keys on it) and must
   * only ever be set by the erasure flow, never via this moderation control
   * (review #3). Any other/garbage value is rejected. */
  private static readonly ADMIN_SETTABLE_STATUSES = [
    'active',
    'suspended',
    'banned',
  ];

  async setUserStatus(actorUserId: string, id: string, status: string) {
    if (!UserService.ADMIN_SETTABLE_STATUSES.includes(status)) {
      throw new BadRequestException(
        `Invalid status. Allowed: ${UserService.ADMIN_SETTABLE_STATUSES.join(', ')}.`,
      );
    }
    if (actorUserId === id) {
      throw new BadRequestException(
        'You cannot change your own account status.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, role: { select: { name: true } } },
    });
    if (!target) throw new NotFoundException('User not found.');

    // Protect superAdmin accounts: only a superAdmin may change one's status, so
    // a merely user:update-privileged admin can't lock out the platform owner.
    if (target.role?.name === 'superAdmin') {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { role: { select: { name: true } } },
      });
      if (actor?.role?.name !== 'superAdmin') {
        throw new ForbiddenException(
          "Only a super admin can change a super admin's status.",
        );
      }
    }

    await this.prisma.user.update({ where: { id }, data: { status } });
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
  }

  findOne(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  update(id: string, updateUserInput: UpdateUserInput) {
    return this.prisma.user.update({ where: { id }, data: updateUserInput });
  }

  remove(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
