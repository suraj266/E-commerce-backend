import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BrandStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateBrandInput } from './dto/create-brand.input';
import { UpdateBrandInput } from './dto/update-brand.input';
import { SetBrandStatusInput } from './dto/set-brand-status.input';

@Injectable()
export class BrandService {
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
    const existing = await this.prisma.brand.findUnique({
      where: { slug: rawSlug },
    });
    if (!existing) return rawSlug;
    if (excludeId && existing.id === excludeId) return rawSlug;
    return `${rawSlug}-${Date.now()}`;
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD
  // ---------------------------------------------------------------------------

  async create(input: CreateBrandInput) {
    // Names are unique globally — protect against case-insensitive collisions
    const nameClash = await this.prisma.brand.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' } },
    });
    if (nameClash && !nameClash.deletedAt) {
      throw new ConflictException(
        `Brand "${input.name}" already exists (id: ${nameClash.id})`,
      );
    }

    const rawSlug = input.slug || this.generateSlug(input.name);
    const finalSlug = await this.ensureUniqueSlug(rawSlug);

    return this.prisma.brand.create({
      data: {
        name: input.name,
        slug: finalSlug,
        description: input.description,
        logoUrl: input.logoUrl,
        bannerUrl: input.bannerUrl,
        websiteUrl: input.websiteUrl,
        countryCode: input.countryCode?.toUpperCase(),
        foundedYear: input.foundedYear,
        isFeatured: input.isFeatured ?? false,
      },
    });
  }

  async findAll(filterStatus?: BrandStatus, featuredOnly?: boolean) {
    return this.prisma.brand.findMany({
      where: {
        deletedAt: null,
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(featuredOnly ? { isFeatured: true } : {}),
      },
      orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findUnique({ where: { id } });
    if (!brand || brand.deletedAt) {
      throw new NotFoundException(`Brand ${id} not found`);
    }
    return brand;
  }

  /** Public — used by /brand/[slug] storefront. */
  async findPublic(slug: string) {
    const brand = await this.prisma.brand.findUnique({ where: { slug } });
    if (!brand || brand.deletedAt || brand.status !== 'ACTIVE') {
      throw new NotFoundException(`Brand "${slug}" not found`);
    }
    return brand;
  }

  async update(input: UpdateBrandInput) {
    const { id, name, slug, countryCode, ...rest } = input;
    const brand = await this.findOne(id);

    const data: Prisma.BrandUpdateInput = { ...rest };

    // Name change — re-check uniqueness
    if (name && name !== brand.name) {
      const clash = await this.prisma.brand.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (clash && !clash.deletedAt) {
        throw new ConflictException(`Brand "${name}" already exists`);
      }
      data.name = name;
    }

    // Slug change — explicit override
    if (slug && slug !== brand.slug) {
      data.slug = await this.ensureUniqueSlug(slug, id);
    }

    if (countryCode) data.countryCode = countryCode.toUpperCase();

    return this.prisma.brand.update({ where: { id }, data });
  }

  async setStatus(input: SetBrandStatusInput) {
    const brand = await this.findOne(input.id);
    return this.prisma.brand.update({
      where: { id: brand.id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    // Soft-delete only. Once products link to brands (Sprint 2.4d), we'll
    // also block delete if products reference this brand.
    return this.prisma.brand.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
