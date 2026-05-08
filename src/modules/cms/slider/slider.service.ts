import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SliderStatus } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateSliderInput } from './dto/create-slider.input';
import { UpdateSliderInput } from './dto/update-slider.input';
import { SetSliderStatusInput } from './dto/set-slider-status.input';
import { AddSlideItemInput } from './dto/add-slide-item.input';
import { UpdateSlideItemInput } from './dto/update-slide-item.input';
import { ReorderSlideItemsInput } from './dto/reorder-slide-items.input';

@Injectable()
export class SliderService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  private async ensureUniqueKey(
    rawKey: string,
    excludeId?: string,
  ): Promise<string> {
    const existing = await this.prisma.slider.findUnique({
      where: { key: rawKey },
    });
    if (!existing) return rawKey;
    if (excludeId && existing.id === excludeId) return rawKey;
    return `${rawKey}-${Date.now()}`;
  }

  private validateConfigJson(json?: string): Prisma.JsonValue {
    if (!json || json.trim() === '') return {};
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new BadRequestException('config must be a JSON object');
      }
      return parsed as Prisma.JsonValue;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('config must be valid JSON');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrate = (row: any) => ({
    ...row,
    config:
      typeof row.config === 'string'
        ? row.config
        : JSON.stringify(row.config ?? {}),
  });

  // ---------------------------------------------------------------------------
  // Public — storefront fetches by key (only PUBLISHED, only enabled items)
  // ---------------------------------------------------------------------------

  async findPublicByKey(key: string) {
    const slider = await this.prisma.slider.findUnique({
      where: { key },
      include: {
        items: {
          where: { deletedAt: null, isEnabled: true },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!slider || slider.deletedAt || slider.status !== SliderStatus.PUBLISHED) {
      throw new NotFoundException(`Slider "${key}" not found`);
    }
    return this.hydrate(slider);
  }

  // ---------------------------------------------------------------------------
  // Admin — list + paginated + by id
  // ---------------------------------------------------------------------------

  async findAllAdmin() {
    const rows = await this.prisma.slider.findMany({
      where: { deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { order: 'asc' },
        },
      },
    });
    return rows.map(this.hydrate);
  }

  async findAllPaginated(args: {
    status?: SliderStatus;
    page?: number;
    pageSize?: number;
    search?: string;
  }) {
    const page = Math.max(1, args.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, args.pageSize ?? 50));
    const search = args.search?.trim() ?? '';

    const where: Prisma.SliderWhereInput = { deletedAt: null };
    if (args.status) where.status = args.status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.slider.count({ where }),
      this.prisma.slider.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          items: {
            where: { deletedAt: null },
            orderBy: { order: 'asc' },
          },
        },
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

  async findOneAdmin(id: string) {
    const slider = await this.prisma.slider.findUnique({
      where: { id },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!slider || slider.deletedAt) {
      throw new NotFoundException(`Slider ${id} not found`);
    }
    return this.hydrate(slider);
  }

  // ---------------------------------------------------------------------------
  // Slider mutations
  // ---------------------------------------------------------------------------

  async create(input: CreateSliderInput) {
    const rawKey = input.key || this.slugify(input.name);
    const finalKey = await this.ensureUniqueKey(rawKey);

    const created = await this.prisma.slider.create({
      data: {
        name: input.name,
        key: finalKey,
        description: input.description,
        config: this.validateConfigJson(input.config) as object,
      },
      include: {
        items: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
      },
    });
    return this.hydrate(created);
  }

  async update(input: UpdateSliderInput) {
    const { id, ...rest } = input;
    const existing = await this.prisma.slider.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Slider ${id} not found`);
    }

    const data: Prisma.SliderUpdateInput = {};
    if (rest.name !== undefined) data.name = rest.name;
    if (rest.description !== undefined) data.description = rest.description;
    if (rest.key !== undefined && rest.key !== existing.key) {
      const conflict = await this.prisma.slider.findUnique({
        where: { key: rest.key },
      });
      if (conflict && conflict.id !== id && !conflict.deletedAt) {
        throw new ConflictException(`Slider key "${rest.key}" already in use`);
      }
      data.key = rest.key;
    }
    if (rest.config !== undefined) {
      data.config = this.validateConfigJson(rest.config) as object;
    }

    const updated = await this.prisma.slider.update({
      where: { id },
      data,
      include: {
        items: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
      },
    });
    return this.hydrate(updated);
  }

  async setStatus(input: SetSliderStatusInput) {
    const existing = await this.prisma.slider.findUnique({
      where: { id: input.id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Slider ${input.id} not found`);
    }
    const updated = await this.prisma.slider.update({
      where: { id: input.id },
      data: { status: input.status },
      include: {
        items: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
      },
    });
    return this.hydrate(updated);
  }

  async remove(id: string) {
    const existing = await this.prisma.slider.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Slider ${id} not found`);
    }
    const removed = await this.prisma.slider.update({
      where: { id },
      data: { deletedAt: new Date(), status: SliderStatus.ARCHIVED },
      include: {
        items: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
      },
    });
    return this.hydrate(removed);
  }

  // ---------------------------------------------------------------------------
  // Slide item mutations
  // ---------------------------------------------------------------------------

  async addItem(input: AddSlideItemInput) {
    const slider = await this.prisma.slider.findUnique({
      where: { id: input.sliderId },
    });
    if (!slider || slider.deletedAt) {
      throw new NotFoundException(`Slider ${input.sliderId} not found`);
    }

    // Auto-order: append at the end if no explicit order given.
    let order = input.order;
    if (order == null) {
      const last = await this.prisma.slideItem.findFirst({
        where: { sliderId: input.sliderId, deletedAt: null },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      order = (last?.order ?? -1) + 1;
    }

    return this.prisma.slideItem.create({
      data: {
        sliderId: input.sliderId,
        title: input.title,
        description: input.description,
        link: input.link,
        ctaLabel: input.ctaLabel,
        imageUrl: input.imageUrl,
        tabletImageUrl: input.tabletImageUrl,
        mobileImageUrl: input.mobileImageUrl,
        order,
        isEnabled: input.isEnabled ?? true,
      },
    });
  }

  async updateItem(input: UpdateSlideItemInput) {
    const { id, ...rest } = input;
    const existing = await this.prisma.slideItem.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Slide item ${id} not found`);
    }

    const data: Prisma.SlideItemUpdateInput = {};
    if (rest.title !== undefined) data.title = rest.title;
    if (rest.description !== undefined) data.description = rest.description;
    if (rest.link !== undefined) data.link = rest.link;
    if (rest.ctaLabel !== undefined) data.ctaLabel = rest.ctaLabel;
    if (rest.imageUrl !== undefined) data.imageUrl = rest.imageUrl;
    if (rest.tabletImageUrl !== undefined)
      data.tabletImageUrl = rest.tabletImageUrl;
    if (rest.mobileImageUrl !== undefined)
      data.mobileImageUrl = rest.mobileImageUrl;
    if (rest.order !== undefined) data.order = rest.order;
    if (rest.isEnabled !== undefined) data.isEnabled = rest.isEnabled;

    return this.prisma.slideItem.update({ where: { id }, data });
  }

  async removeItem(id: string) {
    const existing = await this.prisma.slideItem.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Slide item ${id} not found`);
    }
    return this.prisma.slideItem.update({
      where: { id },
      data: { deletedAt: new Date(), isEnabled: false },
    });
  }

  /** Atomic reorder — assigns each item the index of its position in
   *  itemIds. Validates all IDs belong to the slider (no smuggling). */
  async reorderItems(input: ReorderSlideItemsInput) {
    const items = await this.prisma.slideItem.findMany({
      where: {
        sliderId: input.sliderId,
        deletedAt: null,
        id: { in: input.itemIds },
      },
      select: { id: true },
    });
    if (items.length !== input.itemIds.length) {
      throw new BadRequestException(
        'One or more itemIds do not belong to this slider.',
      );
    }
    await this.prisma.$transaction(
      input.itemIds.map((id, idx) =>
        this.prisma.slideItem.update({
          where: { id },
          data: { order: idx },
        }),
      ),
    );
    return true;
  }
}
