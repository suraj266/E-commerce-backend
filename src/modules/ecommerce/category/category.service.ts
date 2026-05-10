import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateCategoryInput } from './dto/create-category.input';
import { UpdateCategoryInput } from './dto/update-category.input';
import { UpdateCategoryTreeInput } from './dto/update-category-tree.input';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) { }

  generateSlug(name: string) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
  }

  async create(createCategoryInput: CreateCategoryInput) {
    const rawSlug = createCategoryInput.slug || this.generateSlug(createCategoryInput.name);
    // Simple deduplication strategy for slug
    const existing = await this.prisma.category.findUnique({ where: { slug: rawSlug } });
    const finalSlug = existing ? `${rawSlug}-${Date.now()}` : rawSlug;

    return this.prisma.category.create({
      data: {
        ...createCategoryInput,
        slug: finalSlug,
      },
    });
  }

  async findAll() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { displayOrder: 'asc' },
    });
  }

  /**
   * Returns only root (top-level) categories that have at least one ACTIVE
   * product — either directly assigned or assigned to any descendant category.
   * Each result includes `productCount` so the shop filter can display
   * "Electronics (5)". This replaces the old approach of fetching ALL 100+
   * categories and filtering client-side.
   */
  async findShopFilterCategories() {
    // Step 1 — Collect ALL category ids that own at least one active product.
    const catsWithProducts = await this.prisma.category.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        products: {
          some: { status: 'ACTIVE', deletedAt: null },
        },
      },
      select: {
        id: true,
        parentId: true,
        _count: { select: { products: { where: { status: 'ACTIVE', deletedAt: null } } } },
      },
    });

    if (catsWithProducts.length === 0) return [];

    // Step 2 — Walk each category up to its root so we know which root
    // categories should appear in the filter. We also accumulate product
    // counts per root.
    const allCategories = await this.prisma.category.findMany({
      where: { deletedAt: null },
      select: { id: true, parentId: true },
    });
    const parentMap = new Map<string, string | null>(
      allCategories.map((c) => [c.id, c.parentId]),
    );

    // rootId → total product count across all descendants
    const rootCounts = new Map<string, number>();

    for (const cat of catsWithProducts) {
      // Walk up to find the root
      let cursor: string | null = cat.id;
      let rootId = cat.id;
      for (let depth = 0; depth < 15 && cursor; depth++) {
        rootId = cursor;
        cursor = parentMap.get(cursor) ?? null;
      }
      rootCounts.set(rootId, (rootCounts.get(rootId) ?? 0) + cat._count.products);
    }

    // Step 3 — Fetch the actual root category rows
    const rootIds = [...rootCounts.keys()];
    const roots = await this.prisma.category.findMany({
      where: { id: { in: rootIds }, isActive: true, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    return roots.map((r) => ({
      ...r,
      productCount: rootCounts.get(r.id) ?? 0,
    }));
  }


  /**
   * Children of a given parent (or root categories when parentId is null).
   * Each result carries `hasChildren` so the cascading picker UI knows
   * whether to render the next-level dropdown.
   *
   * `limit` is capped at 50 — enough to scroll, small enough to keep the
   * payload tiny on every search keystroke.
   */
  async findChildren(args: {
    parentId?: string | null;
    search?: string;
    limit?: number;
  }) {
    const limit = Math.min(50, Math.max(1, args.limit ?? 10));
    const search = args.search?.trim() ?? '';

    const where: Prisma.CategoryWhereInput = {
      deletedAt: null,
      isActive: true,
      parentId: args.parentId ?? null,
    };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.category.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      take: limit,
      // Single-row peek so we can compute hasChildren without a second
      // round-trip per row (N+1 avoidance).
      include: {
        children: {
          where: { deletedAt: null, isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    return rows.map((r) => ({
      ...r,
      hasChildren: r.children.length > 0,
    }));
  }

  /**
   * Resolves a chain of ancestors for a given category — used by the
   * cascading picker to pre-populate the dropdown path when editing an
   * existing product. Returns ordered: root → ... → category.
   *
   * Includes `hasChildren` for every node so the picker knows whether to
   * keep rendering deeper levels — even after the path gets re-seeded
   * following a user's pick.
   */
  async findAncestors(categoryId: string) {
    const chain: {
      id: string;
      name: string;
      slug: string;
      parentId: string | null;
      hasChildren: boolean;
    }[] = [];
    let cursor: string | null = categoryId;
    // Cap depth — schema permits unlimited but we never go beyond ~5.
    for (let i = 0; i < 12 && cursor; i++) {
      const c = await this.prisma.category.findUnique({
        where: { id: cursor },
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          children: {
            where: { deletedAt: null, isActive: true },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!c) break;
      const { children, ...rest } = c;
      chain.unshift({ ...rest, hasChildren: children.length > 0 });
      cursor = c.parentId;
    }
    return chain;
  }

  /**
   * Paginated + searchable list for the admin Categories table.
   * Search runs on name + slug (case-insensitive). Order: displayOrder asc,
   * then name asc as tiebreaker (the seeded tree has 36 root rows all at
   * displayOrder 0–36 but children all sit at 1, 2, 3 within their parent).
   */
  async findAllPaginated(args: {
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = Math.max(1, args.page ?? 1);
    // Hard cap so a buggy client can't request 100k rows.
    const pageSize = Math.min(200, Math.max(1, args.pageSize ?? 50));
    const search = args.search?.trim() ?? '';

    const where: Prisma.CategoryWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [totalCount, items] = await this.prisma.$transaction([
      this.prisma.category.count({ where }),
      this.prisma.category.findMany({
        where,
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return {
      items,
      totalCount,
      totalPages,
      currentPage: Math.min(page, totalPages),
      pageSize,
    };
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });
    if (!category || category.deletedAt) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }
    return category;
  }

  /**
   * Public lookup by slug — backs `/category/[slug]` storefront page.
   * Returns the category PLUS its immediate active children so the
   * landing page can render sub-category chips without a second round
   * trip. 404s if the category doesn't exist or is inactive/deleted.
   */
  async findBySlugPublic(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
    });
    if (!category || category.deletedAt || !category.isActive) {
      throw new NotFoundException(`Category "${slug}" not found`);
    }
    const children = await this.prisma.category.findMany({
      where: { parentId: category.id, deletedAt: null, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return { ...category, children };
  }

  async update(id: string, updateCategoryInput: UpdateCategoryInput) {
    const { id: _, ...updateData } = updateCategoryInput;

    // Prevent Circular Dependency (Category cannot be its own child/descendant)
    if (updateData.parentId && updateData.parentId !== null) {
      if (updateData.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent.');
      }
      
      // Fetch all categories to check for deep cycles
      const allCategories = await this.prisma.category.findMany({ 
        select: { id: true, parentId: true }
      });
      const parentMap = new Map<string, string | null>(
        allCategories.map(c => [c.id, c.parentId])
      );

      let currentParentId: string | null | undefined = updateData.parentId;
      while (currentParentId) {
        if (currentParentId === id) {
          throw new BadRequestException('Circular dependency detected. A category cannot be a descendant of itself.');
        }
        currentParentId = parentMap.get(currentParentId);
      }
    }

    // Handle optional explicit slug updates
    if (updateData.slug) {
      const existing = await this.prisma.category.findUnique({ where: { slug: updateData.slug } });
      if (existing && existing.id !== id) {
        updateData.slug = `${updateData.slug}-${Date.now()}`;
      }
    }

    return this.prisma.category.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string) {
    // Soft delete
    return this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }


  /**
   * Batch updates categories when drag-and-drop operations occur.
   * Utilizes a database transaction to ensure atomicity.
   */
  async updateTree({ items }: UpdateCategoryTreeInput) {
    // We use a transaction because we are updating multiple records simultaneously.
    const updatePromises = items.map((item) =>
      this.prisma.category.update({
        where: { id: item.id },
        data: {
          parentId: item.parentId || null,
          displayOrder: item.displayOrder,
        },
      })
    );

    // Executes all updates safely; if one fails, none apply.
    await this.prisma.$transaction(updatePromises);
    return true;
  }
}
