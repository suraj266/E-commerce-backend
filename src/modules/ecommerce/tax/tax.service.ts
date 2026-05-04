import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTaxInput } from './dto/create-tax.input';
import { UpdateTaxInput } from './dto/update-tax.input';

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Self / public — seller's product form fetches the active list
  // ---------------------------------------------------------------------------

  /**
   * Active taxes only — what the seller sees in the product form's radio
   * group. Ordered by displayOrder, then name as tiebreaker.
   */
  async findAllActive() {
    const rows = await this.prisma.tax.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(this.formatRate);
  }

  // ---------------------------------------------------------------------------
  // Admin — full table including inactive
  // ---------------------------------------------------------------------------

  async findAllAdmin() {
    const rows = await this.prisma.tax.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map(this.formatRate);
  }

  /**
   * Paginated + searchable feed for the admin Taxes table. Mirrors the
   * `adminCategoriesPaginated` shape so the frontend table can reuse the
   * same pagination component conventions.
   */
  async findAllPaginated(args: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, args.pageSize ?? 50));
    const search = args.search?.trim() ?? '';

    const where: Prisma.TaxWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.tax.count({ where }),
      this.prisma.tax.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return {
      items: rows.map(this.formatRate),
      totalCount,
      totalPages,
      currentPage: Math.min(page, totalPages),
      pageSize,
    };
  }

  async findOne(id: string) {
    const tax = await this.prisma.tax.findUnique({ where: { id } });
    if (!tax || tax.deletedAt) {
      throw new NotFoundException(`Tax ${id} not found`);
    }
    return this.formatRate(tax);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async create(input: CreateTaxInput) {
    const conflict = await this.prisma.tax.findUnique({
      where: { name: input.name },
    });
    if (conflict && !conflict.deletedAt) {
      throw new ConflictException(`Tax "${input.name}" already exists`);
    }
    // Revive a soft-deleted row with the same name instead of erroring out.
    if (conflict && conflict.deletedAt) {
      const revived = await this.prisma.tax.update({
        where: { id: conflict.id },
        data: {
          deletedAt: null,
          rate: input.rate,
          description: input.description,
          isActive: input.isActive ?? true,
          displayOrder: input.displayOrder ?? 0,
        },
      });
      return this.formatRate(revived);
    }
    const created = await this.prisma.tax.create({
      data: {
        name: input.name,
        rate: input.rate,
        description: input.description,
        isActive: input.isActive ?? true,
        displayOrder: input.displayOrder ?? 0,
      },
    });
    return this.formatRate(created);
  }

  async update(input: UpdateTaxInput) {
    const { id, ...rest } = input;
    const existing = await this.prisma.tax.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Tax ${id} not found`);
    }

    if (rest.name && rest.name !== existing.name) {
      const conflict = await this.prisma.tax.findUnique({
        where: { name: rest.name },
      });
      if (conflict && conflict.id !== id && !conflict.deletedAt) {
        throw new ConflictException(`Tax "${rest.name}" already exists`);
      }
    }

    const updated = await this.prisma.tax.update({
      where: { id },
      data: rest,
    });
    return this.formatRate(updated);
  }

  async remove(id: string) {
    const existing = await this.prisma.tax.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Tax ${id} not found`);
    }
    const removed = await this.prisma.tax.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return this.formatRate(removed);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Decimal → number coercion for the GraphQL Float scalar. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatRate = (row: any) => ({
    ...row,
    rate: row.rate != null ? Number(row.rate) : 0,
  });
}
