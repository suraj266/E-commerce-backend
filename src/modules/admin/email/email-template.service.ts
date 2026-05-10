/**
 * EmailTemplateService — admin CRUD for email templates.
 *
 * Templates are seeded via `pnpm seed:emails` (run once after migrations).
 * Admins edit subject + html body + textBody + isEnabled in place; they
 * cannot rename `key` because code references it.
 *
 * System templates (isSystem=true) cannot be disabled — toggling isEnabled
 * to false is silently rejected with a clearer error.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateEmailTemplateInput } from './dto/update-email-template.input';

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.emailTemplate.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async getById(id: string) {
    const row = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Email template not found.');
    return row;
  }

  async getByKey(key: string) {
    return this.prisma.emailTemplate.findUnique({ where: { key } });
  }

  async update(input: UpdateEmailTemplateInput, userId?: string) {
    const existing = await this.getById(input.id);

    // Block disabling SYSTEM templates — they're load-bearing.
    if (
      existing.isSystem &&
      input.isEnabled === false
    ) {
      throw new BadRequestException(
        'System templates cannot be disabled. Edit the body instead.',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: Record<string, any> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.subject !== undefined) data.subject = input.subject;
    if (input.htmlBody !== undefined) data.htmlBody = input.htmlBody;
    if (input.textBody !== undefined) data.textBody = input.textBody || null;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (userId) data.updatedById = userId;

    const row = await this.prisma.emailTemplate.update({
      where: { id: input.id },
      data,
    });
    this.logger.log(`Email template "${row.key}" updated.`);
    return row;
  }

  async toggleEnabled(id: string, enabled: boolean, userId?: string) {
    return this.update({ id, isEnabled: enabled }, userId);
  }
}
