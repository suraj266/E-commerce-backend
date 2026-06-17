/**
 * InvoiceTemplateService — admin CRUD for the tax-invoice template.
 *
 * Mirrors EmailTemplateService. The template is seeded via
 * `pnpm seed:invoices`; admins edit htmlBody + css + name/description in place.
 * `key` is immutable because InvoiceService references it.
 */

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { UpdateInvoiceTemplateInput } from './dto/update-invoice-template.input';

@Injectable()
export class InvoiceTemplateService {
  private readonly logger = new Logger(InvoiceTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.invoiceTemplate.findMany({
      orderBy: [{ name: 'asc' }],
    });
  }

  async getById(id: string) {
    const row = await this.prisma.invoiceTemplate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Invoice template not found.');
    return row;
  }

  /** Returns the row or null (used by the renderer's fallback path). */
  getByKey(key: string) {
    return this.prisma.invoiceTemplate.findUnique({ where: { key } });
  }

  async update(input: UpdateInvoiceTemplateInput, userId?: string) {
    const existing = await this.getById(input.id);

    if (existing.isSystem && input.isEnabled === false) {
      throw new BadRequestException(
        'The tax invoice template cannot be disabled. Edit the body instead.',
      );
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.htmlBody !== undefined) data.htmlBody = input.htmlBody;
    if (input.css !== undefined) data.css = input.css;
    if (input.isEnabled !== undefined) data.isEnabled = input.isEnabled;
    if (userId) data.updatedById = userId;

    const row = await this.prisma.invoiceTemplate.update({
      where: { id: input.id },
      data,
    });
    this.logger.log(`Invoice template "${row.key}" updated.`);
    return row;
  }
}
