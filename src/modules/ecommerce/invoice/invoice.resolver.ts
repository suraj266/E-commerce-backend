import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/identity/auth/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permissions } from '@/common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '@/common/decorators/current-user.decorator';
import { InvoiceService } from './invoice.service';
import { InvoiceTemplateService } from './invoice-template.service';
import { InvoiceTemplate } from './entities/invoice-template.entity';
import {
  PreviewInvoiceTemplateInput,
  UpdateInvoiceTemplateInput,
} from './dto/update-invoice-template.input';
import { TAX_INVOICE_TEMPLATE_KEY } from './templates/tax-invoice.default';

/**
 * GraphQL surface for invoice management.
 *
 *  - Generation runs automatically (InvoiceService trigger wiring in payment
 *    + seller-order services). This resolver exposes the admin **regenerate**
 *    action plus the admin-editable **template** CRUD + live preview.
 *
 * All operations require the `invoice:manage` permission.
 */
@Resolver()
export class InvoiceResolver {
  constructor(
    private readonly invoice: InvoiceService,
    private readonly templates: InvoiceTemplateService,
  ) {}

  // ---------------------------------------------------------------------------
  // SellerOrder invoice regeneration
  // ---------------------------------------------------------------------------

  /**
   * Force a fresh PDF render for the given SellerOrder. Preserves the
   * original `invoiceNumber` — legally a number is never re-issued, only
   * the bytes behind it can change. Returns the public URL of the PDF.
   */
  @Mutation(() => String, {
    description:
      'Force-regenerate the tax invoice for a SellerOrder. Keeps the original invoice number; only replaces the rendered PDF.',
  })
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('invoice:manage')
  async regenerateSellerOrderInvoice(
    @Args('sellerOrderId', { type: () => ID }) sellerOrderId: string,
  ): Promise<string> {
    return this.invoice.regenerateForSellerOrder(sellerOrderId);
  }

  // ---------------------------------------------------------------------------
  // Admin-editable template
  // ---------------------------------------------------------------------------

  /** The canonical `tax_invoice` template (for the admin editor). */
  @Query(() => InvoiceTemplate, { name: 'invoiceTemplate', nullable: true })
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('invoice:manage')
  invoiceTemplate() {
    return this.templates.getByKey(TAX_INVOICE_TEMPLATE_KEY);
  }

  /** All invoice templates (future-proofing — currently just `tax_invoice`). */
  @Query(() => [InvoiceTemplate], { name: 'invoiceTemplates' })
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('invoice:manage')
  invoiceTemplates() {
    return this.templates.list();
  }

  /**
   * Render arbitrary (unsaved) HBS + CSS against a sample invoice context.
   * Returns HTML for the editor's live preview (no PDF, no DB write).
   */
  @Query(() => String, { name: 'previewInvoiceTemplate' })
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('invoice:manage')
  previewInvoiceTemplate(
    @Args('input') input: PreviewInvoiceTemplateInput,
  ): string {
    return this.invoice.previewHtml(input.htmlBody, input.css);
  }

  /** Saves edits to the invoice template (HBS/CSS), stamping the editing user. Auth: invoice:manage permission. */
  @Mutation(() => InvoiceTemplate)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('invoice:manage')
  updateInvoiceTemplate(
    @Args('input') input: UpdateInvoiceTemplateInput,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    return this.templates.update(input, user?.userId);
  }
}
