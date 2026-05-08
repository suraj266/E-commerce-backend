import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateCustomerInput } from './dto/update-customer.input';
import { UpdateMyProfileInput } from './dto/update-my-profile.input';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Flattens a Customer row + nested User into the AdminCustomer GraphQL
   * shape. Centralized so resolvers / list / detail all return the same
   * payload structure.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrate(row: any) {
    return {
      id: row.id,
      userId: row.userId,
      marketingOptIn: row.marketingOptIn,
      preferredCurrency: row.preferredCurrency,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt ?? null,
      // Flattened user fields
      name: row.user?.name ?? '',
      email: row.user?.email ?? '',
      phone: row.user?.phone ?? null,
      status: row.user?.status ?? null,
      emailVerifiedAt: row.user?.emailVerifiedAt ?? null,
      lastLoginAt: row.user?.lastLoginAt ?? null,
      userCreatedAt: row.user?.createdAt ?? row.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Admin list
  // ---------------------------------------------------------------------------

  async findAllPaginated(opts: {
    status?: string;
    search?: string;
    includeDeleted?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

    const userFilter: Prisma.UserWhereInput = {};
    if (opts.status) userFilter.status = opts.status;
    if (opts.search && opts.search.trim()) {
      const q = opts.search.trim();
      userFilter.OR = [
        { email: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ];
    }

    const where: Prisma.CustomerWhereInput = {};
    if (!opts.includeDeleted) where.deletedAt = null;
    if (Object.keys(userFilter).length > 0) where.user = userFilter;

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: { user: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.hydrate(r)),
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
      currentPage: page,
      pageSize,
    };
  }

  async findOneAdmin(id: string) {
    const row = await this.prisma.customer.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!row) throw new NotFoundException('Customer not found');
    return this.hydrate(row);
  }

  // ---------------------------------------------------------------------------
  // Admin update — partial. Splits patches across the User and Customer rows.
  // ---------------------------------------------------------------------------

  async update(input: UpdateCustomerInput) {
    const existing = await this.prisma.customer.findUnique({
      where: { id: input.id },
      include: { user: true },
    });
    if (!existing) throw new NotFoundException('Customer not found');

    const userPatch: Prisma.UserUpdateInput = {};
    const customerPatch: Prisma.CustomerUpdateInput = {};

    if (input.name !== undefined) userPatch.name = input.name;
    if (input.phone !== undefined) userPatch.phone = input.phone || null;
    if (input.status !== undefined) userPatch.status = input.status;
    if (input.marketingOptIn !== undefined)
      customerPatch.marketingOptIn = input.marketingOptIn;
    if (input.preferredCurrency !== undefined)
      customerPatch.preferredCurrency = input.preferredCurrency.toUpperCase();

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (Object.keys(userPatch).length > 0) {
      ops.push(
        this.prisma.user.update({
          where: { id: existing.userId },
          data: userPatch,
        }),
      );
    }
    if (Object.keys(customerPatch).length > 0) {
      ops.push(
        this.prisma.customer.update({
          where: { id: existing.id },
          data: customerPatch,
        }),
      );
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);

    const refreshed = await this.prisma.customer.findUnique({
      where: { id: input.id },
      include: { user: true },
    });
    return this.hydrate(refreshed);
  }

  // ---------------------------------------------------------------------------
  // Admin soft-delete
  // ---------------------------------------------------------------------------

  /**
   * Soft-deletes a customer. Sets `Customer.deletedAt = now()` and forces
   * `User.status = "inactive"` so the account can no longer login. The
   * underlying User row is preserved (for FK integrity with future Order
   * rows). Restore via `restoreCustomer`.
   */
  async softDelete(id: string) {
    const row = await this.prisma.customer.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!row) throw new NotFoundException('Customer not found');
    if (row.deletedAt) {
      throw new ForbiddenException('Customer is already deleted');
    }
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { status: 'inactive' },
      }),
    ]);
    const refreshed = await this.prisma.customer.findUnique({
      where: { id },
      include: { user: true },
    });
    return this.hydrate(refreshed);
  }

  // ---------------------------------------------------------------------------
  // Customer self-serve
  // ---------------------------------------------------------------------------

  /**
   * Resolves the Customer.id for the currently authenticated user. Throws
   * if the user isn't a customer. Mirrors the helper used by wishlist/cart.
   */
  private async getCustomerByUserId(userId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { userId },
      include: { user: true },
    });
    if (!customer) {
      throw new ForbiddenException('Profile is only available to customer accounts.');
    }
    if (customer.deletedAt) {
      throw new ForbiddenException('This account has been archived.');
    }
    return customer;
  }

  async myProfile(userId: string) {
    const customer = await this.getCustomerByUserId(userId);
    return this.hydrate(customer);
  }

  /**
   * Self-serve update — name/phone live on User, marketing/currency on
   * Customer. Identity is taken from the JWT (caller cannot edit anyone
   * else's profile), and status/email are explicitly NOT settable here.
   */
  async updateMyProfile(userId: string, input: UpdateMyProfileInput) {
    const customer = await this.getCustomerByUserId(userId);

    const userPatch: Prisma.UserUpdateInput = {};
    const customerPatch: Prisma.CustomerUpdateInput = {};

    if (input.name !== undefined) userPatch.name = input.name;
    if (input.phone !== undefined) userPatch.phone = input.phone || null;
    if (input.marketingOptIn !== undefined)
      customerPatch.marketingOptIn = input.marketingOptIn;
    if (input.preferredCurrency !== undefined)
      customerPatch.preferredCurrency = input.preferredCurrency.toUpperCase();

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (Object.keys(userPatch).length > 0) {
      ops.push(
        this.prisma.user.update({ where: { id: userId }, data: userPatch }),
      );
    }
    if (Object.keys(customerPatch).length > 0) {
      ops.push(
        this.prisma.customer.update({
          where: { id: customer.id },
          data: customerPatch,
        }),
      );
    }
    if (ops.length > 0) await this.prisma.$transaction(ops);

    const refreshed = await this.prisma.customer.findUnique({
      where: { id: customer.id },
      include: { user: true },
    });
    return this.hydrate(refreshed);
  }

  async restore(id: string) {
    const row = await this.prisma.customer.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!row) throw new NotFoundException('Customer not found');
    if (!row.deletedAt) throw new ForbiddenException('Customer is not deleted');
    await this.prisma.$transaction([
      this.prisma.customer.update({
        where: { id },
        data: { deletedAt: null },
      }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { status: 'active' },
      }),
    ]);
    const refreshed = await this.prisma.customer.findUnique({
      where: { id },
      include: { user: true },
    });
    return this.hydrate(refreshed);
  }
}
