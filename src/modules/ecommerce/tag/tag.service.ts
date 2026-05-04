import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TagStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateTagInput } from './dto/create-tag.input';
import { UpdateTagInput } from './dto/update-tag.input';
import { SetTagStatusInput } from './dto/set-tag-status.input';

@Injectable()
export class TagService {
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
    const existing = await this.prisma.tag.findUnique({
      where: { slug: rawSlug },
    });
    if (!existing) return rawSlug;
    if (excludeId && existing.id === excludeId) return rawSlug;
    return `${rawSlug}-${Date.now()}`;
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD
  // ---------------------------------------------------------------------------

  async create(input: CreateTagInput) {
    // Names are unique globally — protect against case-insensitive dupes
    const nameClash = await this.prisma.tag.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' } },
    });
    if (nameClash && !nameClash.deletedAt) {
      throw new ConflictException(
        `Tag "${input.name}" already exists (id: ${nameClash.id})`,
      );
    }

    const rawSlug = input.slug || this.generateSlug(input.name);
    const finalSlug = await this.ensureUniqueSlug(rawSlug);

    return this.prisma.tag.create({
      data: {
        name: input.name,
        slug: finalSlug,
        description: input.description,
        isFeatured: input.isFeatured ?? false,
      },
    });
  }

  async findAll(filterStatus?: TagStatus, featuredOnly?: boolean) {
    return this.prisma.tag.findMany({
      where: {
        deletedAt: null,
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(featuredOnly ? { isFeatured: true } : {}),
      },
      orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag || tag.deletedAt) {
      throw new NotFoundException(`Tag ${id} not found`);
    }
    return tag;
  }

  /** Public — used by /tag/[slug] storefront. */
  async findPublic(slug: string) {
    const tag = await this.prisma.tag.findUnique({ where: { slug } });
    if (!tag || tag.deletedAt || tag.status !== 'ACTIVE') {
      throw new NotFoundException(`Tag "${slug}" not found`);
    }
    return tag;
  }

  async update(input: UpdateTagInput) {
    const { id, name, slug, ...rest } = input;
    const tag = await this.findOne(id);

    const data: Prisma.TagUpdateInput = { ...rest };

    if (name && name !== tag.name) {
      const clash = await this.prisma.tag.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (clash && !clash.deletedAt) {
        throw new ConflictException(`Tag "${name}" already exists`);
      }
      data.name = name;
    }

    if (slug && slug !== tag.slug) {
      data.slug = await this.ensureUniqueSlug(slug, id);
    }

    return this.prisma.tag.update({ where: { id }, data });
  }

  async setStatus(input: SetTagStatusInput) {
    const tag = await this.findOne(input.id);
    return this.prisma.tag.update({
      where: { id: tag.id },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    // Soft-delete only. Once products attach via M:N junction (Sprint 2.4d),
    // delete will be allowed but with cascade-aware behavior — for now, no
    // FK from Product yet so soft-delete is safe.
    return this.prisma.tag.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
