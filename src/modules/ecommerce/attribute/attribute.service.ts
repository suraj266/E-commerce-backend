import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttributeType, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateAttributeInput } from './dto/create-attribute.input';
import { UpdateAttributeInput } from './dto/update-attribute.input';
import { CreateAttributeValueInput } from './dto/create-attribute-value.input';
import { UpdateAttributeValueInput } from './dto/update-attribute-value.input';
import { ReorderAttributeValuesInput } from './dto/reorder-attribute-values.input';

@Injectable()
export class AttributeService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private generateSlug(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '');
  }

  private async ensureUniqueAttributeSlug(rawSlug: string, excludeId?: string) {
    const existing = await this.prisma.productAttribute.findUnique({
      where: { slug: rawSlug },
    });
    if (!existing) return rawSlug;
    if (excludeId && existing.id === excludeId) return rawSlug;
    return `${rawSlug}-${Date.now()}`;
  }

  private async ensureUniqueValueSlug(
    attributeId: string,
    rawSlug: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.productAttributeValue.findUnique({
      where: { attributeId_slug: { attributeId, slug: rawSlug } },
    });
    if (!existing) return rawSlug;
    if (excludeId && existing.id === excludeId) return rawSlug;
    return `${rawSlug}-${Date.now()}`;
  }

  /** BOOLEAN type doesn't need a values list — block adding values to it. */
  private assertSupportsValues(type: AttributeType) {
    if (type === AttributeType.BOOLEAN) {
      throw new BadRequestException(
        'BOOLEAN attributes don\'t use values (yes/no is implicit)',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Attribute CRUD
  // ---------------------------------------------------------------------------

  async create(input: CreateAttributeInput) {
    const nameClash = await this.prisma.productAttribute.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' } },
    });
    if (nameClash && !nameClash.deletedAt) {
      throw new ConflictException(
        `Attribute "${input.name}" already exists (id: ${nameClash.id})`,
      );
    }

    const rawSlug = input.slug || this.generateSlug(input.name);
    const finalSlug = await this.ensureUniqueAttributeSlug(rawSlug);

    return this.prisma.productAttribute.create({
      data: {
        name: input.name,
        slug: finalSlug,
        description: input.description,
        type: input.type ?? AttributeType.SELECT,
        isVariantAttribute: input.isVariantAttribute ?? false,
      },
      include: {
        values: {
          where: { deletedAt: null },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  }

  async findAll(filterType?: AttributeType, variantOnly?: boolean) {
    return this.prisma.productAttribute.findMany({
      where: {
        deletedAt: null,
        ...(filterType ? { type: filterType } : {}),
        ...(variantOnly ? { isVariantAttribute: true } : {}),
      },
      include: {
        values: {
          where: { deletedAt: null },
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const attribute = await this.prisma.productAttribute.findUnique({
      where: { id },
      include: {
        values: {
          where: { deletedAt: null },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
    if (!attribute || attribute.deletedAt) {
      throw new NotFoundException(`Attribute ${id} not found`);
    }
    return attribute;
  }

  async update(input: UpdateAttributeInput) {
    const { id, name, slug, type, ...rest } = input;
    const attribute = await this.findOne(id);

    const data: Prisma.ProductAttributeUpdateInput = { ...rest };

    if (name && name !== attribute.name) {
      const clash = await this.prisma.productAttribute.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (clash && !clash.deletedAt) {
        throw new ConflictException(`Attribute "${name}" already exists`);
      }
      data.name = name;
    }

    if (slug && slug !== attribute.slug) {
      data.slug = await this.ensureUniqueAttributeSlug(slug, id);
    }

    // Type changes can be destructive — block downgrading to BOOLEAN if values
    // exist (would orphan the values rows).
    if (type && type !== attribute.type) {
      const valuesCount = await this.prisma.productAttributeValue.count({
        where: { attributeId: id, deletedAt: null },
      });
      if (type === AttributeType.BOOLEAN && valuesCount > 0) {
        throw new BadRequestException(
          'Cannot change to BOOLEAN while values exist. Delete the values first.',
        );
      }
      data.type = type;
    }

    return this.prisma.productAttribute.update({
      where: { id },
      data,
      include: {
        values: {
          where: { deletedAt: null },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
  }

  async remove(id: string) {
    const attribute = await this.findOne(id);

    // In Phase B, we'll also block delete if any variant uses this attribute.
    // Currently no variant data exists so soft-delete is safe.
    const usedByVariants = await this.prisma.productVariantAttribute.count({
      where: { attributeId: id },
    });
    if (usedByVariants > 0) {
      throw new BadRequestException(
        `Cannot delete attribute used by ${usedByVariants} variant(s).`,
      );
    }

    return this.prisma.productAttribute.update({
      where: { id: attribute.id },
      data: { deletedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Value CRUD (nested under attribute)
  // ---------------------------------------------------------------------------

  async addValue(input: CreateAttributeValueInput) {
    const attribute = await this.findOne(input.attributeId);
    this.assertSupportsValues(attribute.type);

    // Value uniqueness within attribute (case-insensitive)
    const valueClash = await this.prisma.productAttributeValue.findFirst({
      where: {
        attributeId: input.attributeId,
        value: { equals: input.value, mode: 'insensitive' },
      },
    });
    if (valueClash && !valueClash.deletedAt) {
      throw new ConflictException(
        `Value "${input.value}" already exists for this attribute`,
      );
    }

    const rawSlug = input.slug || this.generateSlug(input.value);
    const finalSlug = await this.ensureUniqueValueSlug(
      input.attributeId,
      rawSlug,
    );

    // If displayOrder not provided, append to end
    let displayOrder = input.displayOrder;
    if (displayOrder == null) {
      const max = await this.prisma.productAttributeValue.aggregate({
        where: { attributeId: input.attributeId, deletedAt: null },
        _max: { displayOrder: true },
      });
      displayOrder = (max._max.displayOrder ?? -1) + 1;
    }

    return this.prisma.productAttributeValue.create({
      data: {
        attributeId: input.attributeId,
        value: input.value,
        slug: finalSlug,
        displayOrder,
      },
    });
  }

  async updateValue(input: UpdateAttributeValueInput) {
    const { id, value, slug, ...rest } = input;
    const existing = await this.prisma.productAttributeValue.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Value ${id} not found`);
    }

    const data: Prisma.ProductAttributeValueUpdateInput = { ...rest };

    if (value && value !== existing.value) {
      const clash = await this.prisma.productAttributeValue.findFirst({
        where: {
          attributeId: existing.attributeId,
          value: { equals: value, mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (clash && !clash.deletedAt) {
        throw new ConflictException(`Value "${value}" already exists`);
      }
      data.value = value;
    }

    if (slug && slug !== existing.slug) {
      data.slug = await this.ensureUniqueValueSlug(
        existing.attributeId,
        slug,
        id,
      );
    }

    return this.prisma.productAttributeValue.update({ where: { id }, data });
  }

  async removeValue(id: string) {
    const existing = await this.prisma.productAttributeValue.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Value ${id} not found`);
    }

    const usedByVariants = await this.prisma.productVariantAttribute.count({
      where: { attributeValueId: id },
    });
    if (usedByVariants > 0) {
      throw new BadRequestException(
        `Cannot delete value used by ${usedByVariants} variant(s).`,
      );
    }

    return this.prisma.productAttributeValue.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Drag-drop reorder. Frontend sends value IDs in the desired top-to-bottom
   * order; we update displayOrder atomically inside a transaction.
   */
  async reorderValues(input: ReorderAttributeValuesInput) {
    // Sanity: all IDs must belong to the named attribute and not be deleted.
    const valuesInDb = await this.prisma.productAttributeValue.findMany({
      where: {
        attributeId: input.attributeId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const dbIds = new Set(valuesInDb.map((v) => v.id));
    for (const id of input.valueIds) {
      if (!dbIds.has(id)) {
        throw new BadRequestException(
          `Value ${id} does not belong to attribute ${input.attributeId}`,
        );
      }
    }

    const ops = input.valueIds.map((id, idx) =>
      this.prisma.productAttributeValue.update({
        where: { id },
        data: { displayOrder: idx },
      }),
    );
    await this.prisma.$transaction(ops);
    return true;
  }
}
