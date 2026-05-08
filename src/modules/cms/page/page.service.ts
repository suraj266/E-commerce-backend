import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreatePageInput } from './dto/create-page.input';
import { UpdatePageInput } from './dto/update-page.input';
import { SetPageStatusInput } from './dto/set-page-status.input';

/**
 * Slugs that map to existing app routes — pages can't claim these or
 * `/admin/pages/about` would shadow `/admin`. Includes top-level routes,
 * Next.js conventions, and likely future endpoints.
 */
const RESERVED_SLUGS = new Set<string>([
  // Auth / system
  'admin',
  'seller',
  'api',
  'auth',
  'login',
  'register',
  'logout',
  'forgot-password',
  'reset-password',
  // Next.js conventions
  '_next',
  'favicon.ico',
  'sitemap.xml',
  'robots.txt',
  // Catalog routes
  'product',
  'products',
  'category',
  'categories',
  'brand',
  'brands',
  'tag',
  'tags',
  'store',
  'stores',
  'search',
  // Future: customer side
  'cart',
  'checkout',
  'account',
  'orders',
  'wishlist',
  'profile',
  'settings',
  // Reserved for the page builder itself
  'p',
  'page',
  'pages',
]);

@Injectable()
export class PageService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertSlugAllowed(slug: string) {
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(
        `Slug "${slug}" is reserved by a system route. Pick a different one.`,
      );
    }
  }

  /** Block JSON sanity check — must parse to an array. We don't enforce
   * the per-block shape on the server (that lives in frontend's registry,
   * intentional) but reject malformed JSON / non-array. */
  private validateBlocksJson(json?: string): string {
    if (!json || json.trim() === '') return '[]';
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        throw new BadRequestException('blocks must be a JSON array');
      }
      return JSON.stringify(parsed);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('blocks must be valid JSON');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrate = (row: any) => ({
    ...row,
    blocks:
      typeof row.blocks === 'string'
        ? row.blocks
        : JSON.stringify(row.blocks ?? []),
  });

  // ---------------------------------------------------------------------------
  // Public — storefront renderer
  // ---------------------------------------------------------------------------

  /** Slug lookup for the public renderer. Only PUBLISHED, non-deleted. */
  async findPublic(slug: string) {
    const page = await this.prisma.page.findUnique({ where: { slug } });
    if (!page || page.deletedAt || page.status !== PageStatus.PUBLISHED) {
      throw new NotFoundException(`Page "${slug}" not found`);
    }
    return this.hydrate(page);
  }

  // ---------------------------------------------------------------------------
  // Admin — full list + paginated table
  // ---------------------------------------------------------------------------

  async findAll(status?: PageStatus) {
    const rows = await this.prisma.page.findMany({
      where: { deletedAt: null, ...(status ? { status } : {}) },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return rows.map(this.hydrate);
  }

  async findOne(id: string) {
    const page = await this.prisma.page.findUnique({ where: { id } });
    if (!page || page.deletedAt) {
      throw new NotFoundException(`Page ${id} not found`);
    }
    return this.hydrate(page);
  }

  async findAllPaginated(args: {
    status?: PageStatus;
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, args.pageSize ?? 50));
    const search = args.search?.trim() ?? '';

    const where: Prisma.PageWhereInput = { deletedAt: null };
    if (args.status) where.status = args.status;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.page.count({ where }),
      this.prisma.page.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    return {
      items: rows.map(this.hydrate),
      totalCount,
      totalPages,
      currentPage: Math.min(page, totalPages),
      pageSize,
    };
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async create(input: CreatePageInput, userId?: string) {
    this.assertSlugAllowed(input.slug);

    const slugConflict = await this.prisma.page.findUnique({
      where: { slug: input.slug },
    });
    if (slugConflict && !slugConflict.deletedAt) {
      throw new ConflictException(`Slug "${input.slug}" already in use`);
    }
    // Revive a soft-deleted page with the same slug.
    if (slugConflict && slugConflict.deletedAt) {
      const revived = await this.prisma.page.update({
        where: { id: slugConflict.id },
        data: {
          title: input.title,
          metaTitle: input.metaTitle,
          metaDesc: input.metaDesc,
          status: PageStatus.DRAFT,
          blocks: this.validateBlocksJson(input.blocks),
          isSystem: input.isSystem ?? false,
          deletedAt: null,
          publishedAt: null,
        },
      });
      return this.hydrate(revived);
    }

    const created = await this.prisma.page.create({
      data: {
        slug: input.slug,
        title: input.title,
        metaTitle: input.metaTitle,
        metaDesc: input.metaDesc,
        blocks: JSON.parse(this.validateBlocksJson(input.blocks)),
        isSystem: input.isSystem ?? false,
        createdById: userId ?? null,
      },
    });
    return this.hydrate(created);
  }

  async update(input: UpdatePageInput) {
    const { id, ...rest } = input;
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Page ${id} not found`);
    }

    if (rest.slug && rest.slug !== existing.slug) {
      this.assertSlugAllowed(rest.slug);
      const conflict = await this.prisma.page.findUnique({
        where: { slug: rest.slug },
      });
      if (conflict && conflict.id !== id && !conflict.deletedAt) {
        throw new ConflictException(`Slug "${rest.slug}" already in use`);
      }
    }

    const data: Prisma.PageUpdateInput = {};
    if (rest.slug !== undefined) data.slug = rest.slug;
    if (rest.title !== undefined) data.title = rest.title;
    if (rest.metaTitle !== undefined) data.metaTitle = rest.metaTitle;
    if (rest.metaDesc !== undefined) data.metaDesc = rest.metaDesc;
    if (rest.blocks !== undefined) {
      data.blocks = JSON.parse(this.validateBlocksJson(rest.blocks));
    }

    const updated = await this.prisma.page.update({ where: { id }, data });
    return this.hydrate(updated);
  }

  async setStatus(input: SetPageStatusInput) {
    const existing = await this.prisma.page.findUnique({
      where: { id: input.id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Page ${input.id} not found`);
    }
    const data: Prisma.PageUpdateInput = { status: input.status };
    // Stamp publishedAt the first time a page goes live.
    if (input.status === PageStatus.PUBLISHED && !existing.publishedAt) {
      data.publishedAt = new Date();
    }
    const updated = await this.prisma.page.update({
      where: { id: input.id },
      data,
    });
    return this.hydrate(updated);
  }

  async remove(id: string) {
    const existing = await this.prisma.page.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Page ${id} not found`);
    }
    if (existing.isSystem) {
      throw new ForbiddenException(
        'System pages cannot be deleted. Archive them instead.',
      );
    }
    const removed = await this.prisma.page.update({
      where: { id },
      data: { deletedAt: new Date(), status: PageStatus.ARCHIVED },
    });
    return this.hydrate(removed);
  }
}
