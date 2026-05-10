import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { SettingGroup } from '@prisma/client';

@Injectable()
export class SiteSettingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get all settings, optionally filtered by group. */
  async findAll(group?: SettingGroup) {
    return this.prisma.siteSetting.findMany({
      where: group ? { group } : undefined,
      orderBy: { key: 'asc' },
    });
  }

  /** Get a single setting by key. Returns null if not found. */
  async findByKey(key: string) {
    return this.prisma.siteSetting.findUnique({ where: { key } });
  }

  /** Get a boolean setting value. Returns the default if the key doesn't exist. */
  async getBoolean(key: string, defaultValue = false): Promise<boolean> {
    const setting = await this.findByKey(key);
    if (!setting) return defaultValue;
    return setting.value === 'true';
  }

  /** Update a setting's value by key. */
  async updateByKey(key: string, value: string) {
    const existing = await this.prisma.siteSetting.findUnique({
      where: { key },
    });
    if (!existing) {
      throw new NotFoundException(`Setting "${key}" not found`);
    }
    return this.prisma.siteSetting.update({
      where: { key },
      data: { value },
    });
  }

  /** Bulk upsert default settings on seed. */
  async seedDefaults(
    defaults: {
      key: string;
      value: string;
      group: SettingGroup;
      label: string;
      description?: string;
      valueType: 'BOOLEAN' | 'STRING' | 'NUMBER' | 'JSON';
    }[],
  ) {
    for (const d of defaults) {
      await this.prisma.siteSetting.upsert({
        where: { key: d.key },
        update: {}, // don't overwrite admin's changes
        create: {
          key: d.key,
          value: d.value,
          group: d.group,
          label: d.label,
          description: d.description,
          valueType: d.valueType,
        },
      });
    }
  }
}
