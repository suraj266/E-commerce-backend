import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateAdminThemeInput } from './dto/update-admin-theme.input';

const SINGLETON_ID = 'global';

const DEFAULTS = {
  primaryLight: 'oklch(0.205 0 0)',
  primaryDark: 'oklch(0.922 0 0)',
  accentLight: 'oklch(0.97 0 0)',
  accentDark: 'oklch(0.269 0 0)',
  sidebarLight: 'oklch(0.985 0 0)',
  sidebarDark: 'oklch(0.205 0 0)',
  destructiveLight: 'oklch(0.577 0.245 27.325)',
  destructiveDark: 'oklch(0.704 0.191 22.216)',
  radius: '0.625rem',
  fontFamily: 'inter',
} as const;

@Injectable()
export class AdminThemeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the singleton theme record. Auto-creates with defaults if the
   * row is somehow missing (defensive — the migration seeds it, but this
   * keeps the read path self-healing).
   */
  async findGlobal() {
    const existing = await this.prisma.adminThemeSetting.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (existing) return existing;

    return this.prisma.adminThemeSetting.create({
      data: { id: SINGLETON_ID, ...DEFAULTS },
    });
  }

  async update(input: UpdateAdminThemeInput, userId?: string) {
    await this.findGlobal();
    return this.prisma.adminThemeSetting.update({
      where: { id: SINGLETON_ID },
      data: {
        ...input,
        updatedById: userId ?? null,
      },
    });
  }

  async reset(userId?: string) {
    await this.findGlobal();
    return this.prisma.adminThemeSetting.update({
      where: { id: SINGLETON_ID },
      data: {
        ...DEFAULTS,
        updatedById: userId ?? null,
      },
    });
  }
}
