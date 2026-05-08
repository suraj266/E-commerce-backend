import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MenuLocation, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { UpsertMenuInput } from './dto/upsert-menu.input';

/**
 * MenuService — single-row-per-location semantics enforced at the DB
 * layer (unique on `location`). The `upsert` method handles both create
 * and update; admin UI only calls upsert.
 *
 * Items are stored as JSON. We don't enforce per-item shape on the server
 * (frontend's MenuItem type does that on parse) but we do verify the
 * top-level shape is a JSON array — malformed input is rejected.
 */
@Injectable()
export class MenuService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Top-level structural validation. Per-item shape is the frontend's job. */
  private validateItemsJson(json: string): string {
    if (!json || json.trim() === '') return '[]';
    try {
      const parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) {
        throw new BadRequestException('items must be a JSON array');
      }
      return JSON.stringify(parsed);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('items must be valid JSON');
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hydrate = (row: any) => ({
    ...row,
    items:
      typeof row.items === 'string'
        ? row.items
        : JSON.stringify(row.items ?? []),
  });

  // ---------------------------------------------------------------------------
  // Public — site-header / site-footer fetch by location
  // ---------------------------------------------------------------------------

  async findPublic(location: MenuLocation) {
    const menu = await this.prisma.menu.findUnique({ where: { location } });
    if (!menu || menu.deletedAt || !menu.isActive) {
      throw new NotFoundException(`Menu for ${location} not found`);
    }
    return this.hydrate(menu);
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async findAllAdmin() {
    const rows = await this.prisma.menu.findMany({
      where: { deletedAt: null },
      orderBy: { location: 'asc' },
    });
    return rows.map(this.hydrate);
  }

  async findOneAdmin(location: MenuLocation) {
    const menu = await this.prisma.menu.findUnique({ where: { location } });
    if (!menu || menu.deletedAt) {
      throw new NotFoundException(`Menu for ${location} not found`);
    }
    return this.hydrate(menu);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Create-or-replace by location. Single mutation since each location
   * holds at most one menu — the unique constraint enforces this.
   * Soft-deleted menus are revived if a new upsert hits the same location.
   */
  async upsert(input: UpsertMenuInput) {
    const itemsJson = this.validateItemsJson(input.items);
    const itemsParsed = JSON.parse(itemsJson);

    const existing = await this.prisma.menu.findUnique({
      where: { location: input.location },
    });

    if (existing) {
      const updated = await this.prisma.menu.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          isActive: input.isActive ?? true,
          items: itemsParsed,
          deletedAt: null,
        },
      });
      return this.hydrate(updated);
    }

    const created = await this.prisma.menu.create({
      data: {
        name: input.name,
        location: input.location,
        isActive: input.isActive ?? true,
        items: itemsParsed,
      },
    });
    return this.hydrate(created);
  }

  async setActive(location: MenuLocation, isActive: boolean) {
    const existing = await this.prisma.menu.findUnique({ where: { location } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Menu for ${location} not found`);
    }
    const updated = await this.prisma.menu.update({
      where: { id: existing.id },
      data: { isActive },
    });
    return this.hydrate(updated);
  }

  async remove(location: MenuLocation) {
    const existing = await this.prisma.menu.findUnique({ where: { location } });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Menu for ${location} not found`);
    }
    const removed = await this.prisma.menu.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return this.hydrate(removed);
  }
}
