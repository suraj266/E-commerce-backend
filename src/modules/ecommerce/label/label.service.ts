import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Label as PrismaLabel, LabelType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateLabelInput } from './dto/create-label.input';
import { UpdateLabelInput } from './dto/update-label.input';
import {
  productMatchesRule,
  validateRuleSet,
} from '../catalog-rules/rule-engine';
import type {
  ProductRuleProjection,
  RuleSet,
} from '../catalog-rules/rule.types';
import type { ProductBadge } from './entities/label.entity';

/** Cached AUTO label (meta + parsed rule) for fast per-product derivation. */
interface AutoLabel {
  key: string;
  name: string;
  color: string;
  textColor: string | null;
  icon: string | null;
  priority: number;
  rule: RuleSet;
}

const AUTO_CACHE_TTL_MS = 60_000;

/**
 * LabelService — admin CRUD for product labels (badges). Mirrors TagService.
 *
 * MANUAL labels are hand-assigned to products. AUTO labels carry a validated
 * RuleSet (stored as JSON) and are derived per product at read time. `key` is
 * immutable; system labels can be edited but not deleted.
 */
@Injectable()
export class LabelService {
  constructor(private readonly prisma: PrismaService) {}

  // AUTO labels rarely change; cache the parsed set briefly so deriving badges
  // across a product list doesn't re-query/re-parse per product.
  private autoCache: { at: number; labels: AutoLabel[] } | null = null;

  // ---------------------------------------------------------------------------
  // Mapping — `rule` Json <-> JSON string for GraphQL
  // ---------------------------------------------------------------------------

  private toEntity(row: PrismaLabel) {
    return {
      ...row,
      rule: row.rule ? JSON.stringify(row.rule) : null,
    };
  }

  /** Parse + validate the JSON rule string for an AUTO label. */
  private parseRule(type: LabelType, rule?: string): Prisma.InputJsonValue | undefined {
    if (type !== LabelType.AUTO) return undefined; // MANUAL → no rule
    if (!rule || !rule.trim()) {
      throw new BadRequestException('AUTO labels require a rule.');
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

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Enabled labels — used by the product form picker (filters MANUAL itself). */
  async findEnabled() {
    const rows = await this.prisma.label.findMany({
      where: { deletedAt: null, isEnabled: true },
      orderBy: [{ priority: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.toEntity(r));
  }

  async findAll() {
    const rows = await this.prisma.label.findMany({
      where: { deletedAt: null },
      orderBy: [{ priority: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.toEntity(r));
  }

  async findOne(id: string) {
    const row = await this.prisma.label.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw new NotFoundException(`Label ${id} not found`);
    return this.toEntity(row);
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async create(input: CreateLabelInput) {
    const keyClash = await this.prisma.label.findUnique({
      where: { key: input.key },
    });
    if (keyClash && !keyClash.deletedAt) {
      throw new ConflictException(`Label key "${input.key}" already exists`);
    }
    const rule = this.parseRule(input.type, input.rule);

    const row = await this.prisma.label.create({
      data: {
        key: input.key,
        name: input.name,
        color: input.color,
        textColor: input.textColor,
        icon: input.icon,
        type: input.type,
        rule,
        priority: input.priority ?? 100,
        isEnabled: input.isEnabled ?? true,
        displayOrder: input.displayOrder ?? 0,
      },
    });
    this.invalidateAutoCache();
    return this.toEntity(row);
  }

  async update(input: UpdateLabelInput) {
    const existing = await this.findOne(input.id);
    const nextType = input.type ?? (existing.type as LabelType);

    const data: Prisma.LabelUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.color !== undefined) data.color = input.color;
    if (input.textColor !== undefined) data.textColor = input.textColor;
    if (input.icon !== undefined) data.icon = input.icon;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;
    if (input.type !== undefined) data.type = input.type;

    // Re-validate rule whenever type or rule changes.
    if (input.type !== undefined || input.rule !== undefined) {
      if (nextType === LabelType.AUTO) {
        data.rule = this.parseRule(LabelType.AUTO, input.rule) ?? Prisma.JsonNull;
      } else {
        data.rule = Prisma.JsonNull; // MANUAL → clear any rule
      }
    }

    const row = await this.prisma.label.update({
      where: { id: input.id },
      data,
    });
    this.invalidateAutoCache();
    return this.toEntity(row);
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    if (existing.isSystem) {
      throw new BadRequestException('System labels cannot be deleted.');
    }
    const row = await this.prisma.label.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.invalidateAutoCache();
    return this.toEntity(row);
  }

  // ---------------------------------------------------------------------------
  // Badge derivation (manual + auto) — consumed by the Product `labels` field
  // ---------------------------------------------------------------------------

  private invalidateAutoCache() {
    this.autoCache = null;
  }

  /** Enabled AUTO labels with parsed rules, cached briefly. */
  private async getEnabledAutoLabels(): Promise<AutoLabel[]> {
    const now = Date.now();
    if (this.autoCache && now - this.autoCache.at < AUTO_CACHE_TTL_MS) {
      return this.autoCache.labels;
    }
    const rows = await this.prisma.label.findMany({
      where: { deletedAt: null, isEnabled: true, type: LabelType.AUTO },
      orderBy: { priority: 'asc' },
    });
    const labels: AutoLabel[] = [];
    for (const r of rows) {
      if (!r.rule) continue;
      try {
        labels.push({
          key: r.key,
          name: r.name,
          color: r.color,
          textColor: r.textColor,
          icon: r.icon,
          priority: r.priority,
          rule: validateRuleSet(r.rule),
        });
      } catch {
        // A malformed persisted rule shouldn't break product reads — skip it.
      }
    }
    this.autoCache = { at: now, labels };
    return labels;
  }

  /**
   * Merge a product's MANUAL labels (from the included junction) with any
   * matching AUTO labels, de-duped by key (manual wins), sorted by priority.
   * Returns the full set; the frontend caps to the top 1-2.
   *
   * `product` is the hydrated Product object (must carry: onSale, createdAt,
   * categoryId, brandId, tags[], basePrice, unitsSold7d/30d, isFeatured, and
   * the manual `labels` junction).
   */
  async deriveBadges(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    product: any,
    now: Date = new Date(),
  ): Promise<ProductBadge[]> {
    const byKey = new Map<string, ProductBadge>();

    // 1. Manual labels assigned to the product (already filtered enabled).
    for (const l of (product.labels ?? []) as PrismaLabel[]) {
      byKey.set(l.key, {
        key: l.key,
        name: l.name,
        color: l.color,
        textColor: l.textColor,
        icon: l.icon,
        priority: l.priority,
      });
    }

    // 2. Auto labels whose rule matches this product.
    const projection: ProductRuleProjection = {
      onSale: Boolean(product.onSale),
      createdAt: product.createdAt
        ? new Date(product.createdAt)
        : new Date(0),
      categoryId: product.categoryId ?? null,
      brandId: product.brandId ?? null,
      tagIds: ((product.tags ?? []) as { id: string }[]).map((t) => t.id),
      price:
        product.basePrice != null
          ? Number(product.basePrice)
          : product.price != null
            ? Number(product.price)
            : null,
      unitsSold7d: Number(product.unitsSold7d ?? 0),
      unitsSold30d: Number(product.unitsSold30d ?? 0),
      isFeatured: Boolean(product.isFeatured),
    };

    const autos = await this.getEnabledAutoLabels();
    for (const a of autos) {
      if (byKey.has(a.key)) continue; // manual already present
      if (productMatchesRule(projection, a.rule, now)) {
        byKey.set(a.key, {
          key: a.key,
          name: a.name,
          color: a.color,
          textColor: a.textColor,
          icon: a.icon,
          priority: a.priority,
        });
      }
    }

    return [...byKey.values()].sort((x, y) => x.priority - y.priority);
  }
}
