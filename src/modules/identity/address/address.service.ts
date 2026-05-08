import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateAddressInput } from './dto/create-address.input';
import { UpdateAddressInput } from './dto/update-address.input';

/**
 * Address service — `UserAddress` CRUD scoped to the authenticated user.
 *
 * Identity comes from the JWT (`req.user.userId`); callers cannot read or
 * write someone else's addresses. The architectural docs call out one
 * default address per user, which we enforce on the application layer
 * (Postgres doesn't have partial-unique-on-true semantics built in).
 */
@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async assertOwnership(userId: string, addressId: string) {
    const row = await this.prisma.userAddress.findUnique({
      where: { id: addressId },
    });
    if (!row) throw new NotFoundException('Address not found');
    if (row.userId !== userId) {
      throw new ForbiddenException('You do not own this address.');
    }
    return row;
  }

  /**
   * Atomically clears `isDefault` on every other row for this user, then
   * promotes the given row. Single transaction so we can never end up with
   * two defaults or zero (when we wanted one).
   */
  private async promoteToDefault(userId: string, addressId: string) {
    await this.prisma.$transaction([
      this.prisma.userAddress.updateMany({
        where: { userId, NOT: { id: addressId } },
        data: { isDefault: false },
      }),
      this.prisma.userAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
      }),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  myAddresses(userId: string) {
    return this.prisma.userAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { id: 'asc' }],
    });
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async create(userId: string, input: CreateAddressInput) {
    // First-ever address for this user is forced to default — UX expects
    // checkout to find at least one default once any addresses exist.
    const count = await this.prisma.userAddress.count({ where: { userId } });
    const shouldBeDefault = input.isDefault === true || count === 0;

    const created = await this.prisma.userAddress.create({
      data: {
        userId,
        type: input.type,
        label: input.label ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? null,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        countryCode: input.countryCode.toUpperCase(),
        isDefault: shouldBeDefault,
      },
    });

    // If the customer asked for default and there were already others,
    // demote the rest. Skipped when this is the first row (already default).
    if (shouldBeDefault && count > 0) {
      await this.promoteToDefault(userId, created.id);
    }

    return this.prisma.userAddress.findUnique({ where: { id: created.id } });
  }

  async update(userId: string, input: UpdateAddressInput) {
    const existing = await this.assertOwnership(userId, input.id);

    const patch: Record<string, unknown> = {};
    if (input.type !== undefined) patch.type = input.type;
    if (input.label !== undefined) patch.label = input.label || null;
    if (input.firstName !== undefined) patch.firstName = input.firstName;
    if (input.lastName !== undefined) patch.lastName = input.lastName;
    if (input.phone !== undefined) patch.phone = input.phone || null;
    if (input.addressLine1 !== undefined)
      patch.addressLine1 = input.addressLine1;
    if (input.addressLine2 !== undefined)
      patch.addressLine2 = input.addressLine2 || null;
    if (input.city !== undefined) patch.city = input.city;
    if (input.state !== undefined) patch.state = input.state;
    if (input.postalCode !== undefined) patch.postalCode = input.postalCode;
    if (input.countryCode !== undefined)
      patch.countryCode = input.countryCode.toUpperCase();

    if (Object.keys(patch).length > 0) {
      await this.prisma.userAddress.update({
        where: { id: existing.id },
        data: patch,
      });
    }

    // Default flip: handle separately so we can run the demote-others
    // transaction. `isDefault: false` on the only/default row is rejected
    // (must promote another first).
    if (input.isDefault === true && !existing.isDefault) {
      await this.promoteToDefault(userId, existing.id);
    } else if (input.isDefault === false && existing.isDefault) {
      const others = await this.prisma.userAddress.count({
        where: { userId, NOT: { id: existing.id } },
      });
      if (others === 0) {
        throw new ForbiddenException(
          'You need at least one default address. Promote another address first.',
        );
      }
      await this.prisma.userAddress.update({
        where: { id: existing.id },
        data: { isDefault: false },
      });
    }

    return this.prisma.userAddress.findUnique({ where: { id: existing.id } });
  }

  async setDefault(userId: string, addressId: string) {
    const existing = await this.assertOwnership(userId, addressId);
    if (!existing.isDefault) {
      await this.promoteToDefault(userId, existing.id);
    }
    return this.prisma.userAddress.findUnique({ where: { id: existing.id } });
  }

  /**
   * Hard-deletes the address. If the deleted row was the default and other
   * addresses exist, promotes the most recently created one so the user
   * always has a default once they have any addresses at all.
   */
  async remove(userId: string, addressId: string) {
    const existing = await this.assertOwnership(userId, addressId);
    await this.prisma.userAddress.delete({ where: { id: existing.id } });

    if (existing.isDefault) {
      const next = await this.prisma.userAddress.findFirst({
        where: { userId },
        orderBy: { id: 'desc' },
      });
      if (next) {
        await this.prisma.userAddress.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
    return existing;
  }
}
