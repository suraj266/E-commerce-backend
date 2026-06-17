import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CollectionType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateCollectionInput } from './dto/create-collection.input';
import { UpdateCollectionInput } from './dto/update-collection.input';
import { validateRuleSet } from '../catalog-rules/rule-engine';

const WITH_PRODUCT_IDS = {
  products: { where: { deletedAt: null }, select: { id: true } },
} as const;

type CollectionRow = Prisma.CollectionGetPayload<{
  include: typeof WITH_PRODUCT_IDS;
}>;

/**
 * CollectionService — admin CRUD + membership for product collections.
 * Mirrors TagService/LabelService. MANUAL collections hold a product junction;
 * SMART collections carry a validated RuleSet resolved at query time.
 */
@Injectable()
export class CollectionService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private generateSlug(name: string) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  private async ensureUniqueSlug(rawSlug: string, excludeId?: string) {
    const existing = await this.prisma.collection.findUnique({
      where: { slug: rawSlug },
    });
    if (!existing) return rawSlug;
    if (excludeId && existing.id === excludeId) return rawSlug;
    return `${rawSlug}-${Date.now()}`;
  }

  private parseRule(
    type: CollectionType,
    rule?: string,
  ): Prisma.InputJsonValue | undefined {
    if (type !== CollectionType.SMART) return undefined;
    if (!rule || !rule.trim()) {
      throw new BadRequestException('SMART collections require a rule.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rule);
    } catch {
      throw new BadRequestException('rule must be valid JSON.');
    }
    try {
      return validateRuleSet(parsed) as unknown as Prisma.InputJsonValue;
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  private toEntity(row: CollectionRow) {
    return {
      ...row,
      rule: row.rule ? JSON.stringify(row.rule) : null,
      productIds: row.products.map((p) => p.id),
    };
  }

  private async filterValidProductIds(productIds?: string[] | null) {
    if (!productIds || productIds.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: { id: true },
    });
    return products.map((p) => p.id);
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async findAll(status?: 'ACTIVE' | 'INACTIVE', featuredOnly?: boolean) {
    const rows = await this.prisma.collection.findMany({
      where: {
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(featuredOnly ? { isFeatured: true } : {}),
      },
      include: WITH_PRODUCT_IDS,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.toEntity(r));
  }

  async findOne(id: string) {
    const row = await this.prisma.collection.findUnique({
      where: { id },
      include: WITH_PRODUCT_IDS,
    });
    if (!row || row.deletedAt) throw new NotFoundException(`Collection ${id} not found`);
    return this.toEntity(row);
  }

  /** Public — used by /collections/[slug] for the header. */
  async findPublic(slug: string) {
    const row = await this.prisma.collection.findUnique({
      where: { slug },
      include: WITH_PRODUCT_IDS,
    });
    if (!row || row.deletedAt || row.status !== 'ACTIVE') {
      throw new NotFoundException(`Collection "${slug}" not found`);
    }
    return this.toEntity(row);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async create(input: CreateCollectionInput) {
    const nameClash = await this.prisma.collection.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' }, deletedAt: null },
    });
    if (nameClash) {
      throw new ConflictException(`Collection "${input.name}" already exists`);
    }

    const rawSlug = input.slug || this.generateSlug(input.name);
    const finalSlug = await this.ensureUniqueSlug(rawSlug);
    const rule = this.parseRule(input.type, input.rule);
    const productIds =
      input.type === CollectionType.MANUAL
        ? await this.filterValidProductIds(input.productIds)
        : [];

    const row = await this.prisma.collection.create({
      data: {
        name: input.name,
        slug: finalSlug,
        description: input.description,
        bannerUrl: input.bannerUrl,
        imageUrl: input.imageUrl,
        type: input.type,
        rule,
        status: input.status ?? 'ACTIVE',
        isFeatured: input.isFeatured ?? false,
        displayOrder: input.displayOrder ?? 0,
        products: { connect: productIds.map((id) => ({ id })) },
      },
      include: WITH_PRODUCT_IDS,
    });
    return this.toEntity(row);
  }

  async update(input: UpdateCollectionInput) {
    const existing = await this.findOne(input.id);
    const nextType = (input.type ?? existing.type) as CollectionType;

    const data: Prisma.CollectionUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.bannerUrl !== undefined) data.bannerUrl = input.bannerUrl;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.status !== undefined) data.status = input.status;
    if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;
    if (input.type !== undefined) data.type = input.type;

    if (input.slug && input.slug !== existing.slug) {
      data.slug = await this.ensureUniqueSlug(input.slug, input.id);
    }

    // Re-validate rule when type or rule changes.
    if (input.type !== undefined || input.rule !== undefined) {
      data.rule =
        nextType === CollectionType.SMART
          ? this.parseRule(CollectionType.SMART, input.rule) ?? Prisma.JsonNull
          : Prisma.JsonNull;
    }

    // Manual membership set (only meaningful for MANUAL collections).
    if (input.productIds !== undefined) {
      const ids =
        nextType === CollectionType.MANUAL
          ? await this.filterValidProductIds(input.productIds)
          : [];
      data.products = { set: ids.map((id) => ({ id })) };
    } else if (nextType === CollectionType.SMART) {
      // Switching to SMART clears any manual membership.
      data.products = { set: [] };
    }

    const row = await this.prisma.collection.update({
      where: { id: input.id },
      data,
      include: WITH_PRODUCT_IDS,
    });
    return this.toEntity(row);
  }

  async remove(id: string) {
    await this.findOne(id);
    const row = await this.prisma.collection.update({
      where: { id },
      data: { deletedAt: new Date() },
      include: WITH_PRODUCT_IDS,
    });
    return this.toEntity(row);
  }
}
