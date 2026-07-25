import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import * as Handlebars from 'handlebars';
import * as puppeteer from 'puppeteer';
import sharp from 'sharp';
import { PrismaService } from '@/prisma/prisma.service';
import { SiteSettingService } from '@/modules/admin/site-setting/site-setting.service';
import { MetricsService } from '@/modules/observability/metrics/metrics.service';
import { InvoiceNumberService } from './invoice-number.service';
import { InvoiceStorageService } from './invoice-storage.service';
import { InvoiceTemplateService } from './invoice-template.service';
import { numberToIndianWords } from './indian-number-words';
import {
  DEFAULT_TAX_INVOICE_HBS,
  DEFAULT_TAX_INVOICE_CSS,
  TAX_INVOICE_TEMPLATE_KEY,
} from './templates/tax-invoice.default';

/**
 * Tax invoice generator.
 *
 * Orchestrates: number allocation → context build → HTML render →
 * PDF render → storage upload → persistence on SellerOrder.
 *
 * Idempotent: re-running on an order that already has `invoiceUrl` returns
 * the cached URL. Use the admin `regenerateInvoice` mutation to force a
 * new render — that clears `invoiceUrl` first but keeps the original
 * `invoiceNumber` for audit (a single invoice number is never re-issued).
 */
@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);
  // Reused across calls so we don't pay puppeteer startup on every invoice.
  // Closed lazily when idle for 5 minutes (Phase 1 keeps it always-alive;
  // wire shutdown lifecycle in Phase 2 if memory becomes a concern).
  private browser: puppeteer.Browser | null = null;

  // In-memory cache of base64-inlined logos, keyed by source URL. Logos rarely
  // change and a new upload yields a new URL (so a changed logo is an instant
  // cache miss); only a same-URL byte replacement waits for the TTL to expire.
  private readonly logoCache = new Map<
    string,
    { dataUri: string | null; expiresAt: number }
  >();
  private static readonly LOGO_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly LOGO_FETCH_TIMEOUT_MS = 4000;
  private static readonly LOGO_MAX_BYTES = 512 * 1024; // 512 KB
  private static readonly LOGO_MAX_WIDTH = 240; // px — bounds PDF size

  constructor(
    private readonly prisma: PrismaService,
    private readonly numberSvc: InvoiceNumberService,
    private readonly storage: InvoiceStorageService,
    private readonly templates: InvoiceTemplateService,
    private readonly config: ConfigService,
    private readonly siteSettings: SiteSettingService,
    // Optional trailing param (MetricsModule is @Global). The counter is a
    // fire-and-forget side effect guarded with `?.` — never fails a render.
    private readonly metrics?: MetricsService,
  ) {
    this.registerHelpers();
  }

  /**
   * Reserve (allocate + persist) the invoice number for a SellerOrder WITHOUT
   * rendering — the load-bearing half of the GST-sequence-safety fix.
   *
   * Idempotent: if a number is already bound, it's returned as-is. Otherwise a
   * number is allocated and persisted onto the SellerOrder in ONE transaction,
   * so the sequence counter and the bound number commit together. A row-level
   * `FOR UPDATE` lock serialises the (rare) concurrent reserve of the same
   * SellerOrder so a duplicate reserve can never burn a second number.
   *
   * Because allocation is now separate from the Puppeteer render + S3 upload, a
   * render/upload failure never advances the per-seller GST sequence (CGST Rule
   * 46). A retry re-renders under the SAME reserved number → the counter
   * advances exactly once per invoice.
   */
  async reserveInvoiceNumber(
    sellerOrderId: string,
  ): Promise<{ invoiceNumber: string; invoiceDate: Date }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        {
          id: string;
          sellerId: string;
          invoiceNumber: string | null;
          invoiceDate: Date | null;
        }[]
      >(
        Prisma.sql`SELECT "id", "sellerId", "invoiceNumber", "invoiceDate" FROM "SellerOrder" WHERE "id" = ${sellerOrderId} FOR UPDATE`,
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Seller order ${sellerOrderId} not found`);
      }
      const so = rows[0];
      // Already reserved (a prior attempt, or the regenerate path) — reuse it.
      if (so.invoiceNumber && so.invoiceDate) {
        return {
          invoiceNumber: so.invoiceNumber,
          invoiceDate: so.invoiceDate,
        };
      }

      const allocated = await this.numberSvc.allocateInTx(tx, so.sellerId);
      await tx.sellerOrder.update({
        where: { id: sellerOrderId },
        data: {
          invoiceNumber: allocated.invoiceNumber,
          invoiceDate: allocated.invoiceDate,
        },
      });
      return allocated;
    });
  }

  /**
   * Idempotent invoice generation for one SellerOrder.
   *
   * Order of operations (GST-safe):
   *   1. if `invoiceUrl` is already set → return the cached URL.
   *   2. reserve the invoice number (allocate + persist, in its own tx).
   *   3. build context consuming the RESERVED number, render HTML → PDF, upload.
   *   4. persist ONLY `invoiceUrl` on success.
   *
   * A failure in step 3 leaves the reserved number bound but `invoiceUrl` null;
   * a retry re-renders under the same number. The sequence is never burned.
   *
   * Returns the public URL where the PDF lives.
   */
  async generateForSellerOrder(sellerOrderId: string): Promise<string> {
    const existing = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: { invoiceUrl: true },
    });
    if (existing?.invoiceUrl) return existing.invoiceUrl;

    // Allocate + bind the number BEFORE the render, so a render/upload failure
    // can never burn a GST sequence number.
    const reserved = await this.reserveInvoiceNumber(sellerOrderId);

    const ctx = await this.buildContext(sellerOrderId, {
      forceInvoiceNumber: reserved.invoiceNumber,
      forceInvoiceDate: reserved.invoiceDate,
    });
    const html = await this.renderHtml(ctx);
    const pdf = await this.renderPdf(html);
    const url = await this.storage.putPdf(
      ctx.seller.id,
      ctx.invoiceNumber,
      pdf,
    );

    // Only `invoiceUrl` is written here — the number + date were persisted by
    // reserveInvoiceNumber above.
    await this.prisma.sellerOrder.update({
      where: { id: sellerOrderId },
      data: { invoiceUrl: url },
    });

    // A tax invoice was rendered + uploaded (this line is past the early-return
    // cache hit, so it counts genuinely-new renders only). Side-effect-only.
    this.metrics?.recordInvoiceGenerated();

    this.logger.log(
      `Invoice ${ctx.invoiceNumber} generated for seller-order ${sellerOrderId}`,
    );
    return url;
  }

  /**
   * Force-regenerate. Keeps the original invoice number (legally numbers
   * are never re-issued) but rebuilds + replaces the PDF at the same key.
   * Used by admin "regenerate" UI after template fixes.
   */
  async regenerateForSellerOrder(sellerOrderId: string): Promise<string> {
    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      select: { invoiceNumber: true, invoiceDate: true, sellerId: true },
    });
    if (!so) throw new NotFoundException('Seller order not found');

    // If we never allocated a number, fall through to the normal path.
    if (!so.invoiceNumber || !so.invoiceDate) {
      await this.prisma.sellerOrder.update({
        where: { id: sellerOrderId },
        data: { invoiceUrl: null },
      });
      return this.generateForSellerOrder(sellerOrderId);
    }

    const ctx = await this.buildContext(sellerOrderId, {
      forceInvoiceNumber: so.invoiceNumber,
      forceInvoiceDate: so.invoiceDate,
    });
    const html = await this.renderHtml(ctx);
    const pdf = await this.renderPdf(html);
    const url = await this.storage.putPdf(
      so.sellerId,
      so.invoiceNumber,
      pdf,
    );

    await this.prisma.sellerOrder.update({
      where: { id: sellerOrderId },
      data: { invoiceUrl: url },
    });
    // A tax invoice PDF was re-rendered + re-uploaded. Side-effect-only.
    this.metrics?.recordInvoiceGenerated();
    this.logger.log(`Invoice ${so.invoiceNumber} regenerated`);
    return url;
  }

  // ---------------------------------------------------------------------------
  // Context builder
  // ---------------------------------------------------------------------------

  private async buildContext(
    sellerOrderId: string,
    opts: { forceInvoiceNumber?: string; forceInvoiceDate?: Date } = {},
  ): Promise<InvoiceContext> {
    const so = await this.prisma.sellerOrder.findUnique({
      where: { id: sellerOrderId },
      include: {
        items: true,
        seller: true,
        store: true,
        order: {
          include: {
            customer: { include: { user: true } },
            shippingAddress: true,
            billingAddress: true,
          },
        },
      },
    });
    if (!so) {
      throw new NotFoundException(`Seller order ${sellerOrderId} not found`);
    }

    // Allocate the invoice number unless the caller pinned it (regenerate
    // path). Allocation only happens at this point — never during placement
    // — so cancelled-before-confirmation orders don't burn numbers.
    let invoiceNumber = opts.forceInvoiceNumber;
    let invoiceDate = opts.forceInvoiceDate;
    if (!invoiceNumber || !invoiceDate) {
      const allocated = await this.numberSvc.allocate(so.sellerId);
      invoiceNumber = allocated.invoiceNumber;
      invoiceDate = allocated.invoiceDate;
    }

    const isIntraState = so.taxKind === 'INTRA_STATE';
    const hasCess = so.items.some((it) => Number(it.cessAmount) > 0);

    const items = so.items.map((it) => {
      const lineTotal =
        Number(it.taxableValue) +
        Number(it.cgstAmount) +
        Number(it.sgstAmount) +
        Number(it.igstAmount) +
        Number(it.cessAmount);
      return {
        name: it.name,
        variantName: it.variantName,
        sku: it.sku,
        hsnCode: it.hsnCode ?? '—',
        countryOfOrigin: it.countryOfOrigin ?? '—',
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        taxableValue: Number(it.taxableValue),
        cgstRate: Number(it.cgstRate),
        cgstAmount: Number(it.cgstAmount),
        sgstRate: Number(it.sgstRate),
        sgstAmount: Number(it.sgstAmount),
        igstRate: Number(it.igstRate),
        igstAmount: Number(it.igstAmount),
        cessRate: Number(it.cessRate),
        cessAmount: Number(it.cessAmount),
        lineTotal,
      };
    });

    // Shipping is a COMPOSITE SUPPLY (CGST §8): its tax-inclusive charge was
    // back-calculated at placement into a taxable value + GST split at the
    // PRINCIPAL item's rate, persisted on the SellerOrder. We render it as a
    // synthetic line item so the table footer + summary + grand total all sum
    // it naturally and `taxableValue + taxes + cess == grandTotal` (Rule 46
    // tie-out). Display rates are derived from the persisted amounts.
    const shippingCharge = Number(so.shippingAmount);
    if (shippingCharge > 0) {
      const shipTaxable = Number(so.shippingTaxableValue);
      const shipCgst = Number(so.shippingCgstAmount);
      const shipSgst = Number(so.shippingSgstAmount);
      const shipIgst = Number(so.shippingIgstAmount);
      const ratePct = (amt: number) =>
        shipTaxable > 0 ? Math.round((amt / shipTaxable) * 10000) / 100 : 0;
      items.push({
        name: 'Shipping & handling',
        variantName: 'Composite supply — taxed at principal item rate',
        sku: '—',
        hsnCode: '996819',
        countryOfOrigin: '—',
        quantity: 1,
        unitPrice: shippingCharge,
        taxableValue: shipTaxable,
        cgstRate: ratePct(shipCgst),
        cgstAmount: shipCgst,
        sgstRate: ratePct(shipSgst),
        sgstAmount: shipSgst,
        igstRate: ratePct(shipIgst),
        igstAmount: shipIgst,
        cessRate: 0,
        cessAmount: 0,
        lineTotal: shippingCharge,
      });
    }

    const totals = {
      taxableValue: items.reduce((s, it) => s + it.taxableValue, 0),
      cgst: items.reduce((s, it) => s + it.cgstAmount, 0),
      sgst: items.reduce((s, it) => s + it.sgstAmount, 0),
      igst: items.reduce((s, it) => s + it.igstAmount, 0),
      cess: items.reduce((s, it) => s + it.cessAmount, 0),
      shipping: shippingCharge,
      grandTotal: items.reduce((s, it) => s + it.lineTotal, 0),
    };

    const order = so.order;
    const shippingAddr = order.shippingAddress;
    const billingAddr = order.billingAddress ?? shippingAddr;
    const customerUser = order.customer.user;

    // Brand identity: prefer the admin-managed SiteSetting, fall back to the
    // PLATFORM_NAME env var so unseeded DBs still render. The platform logo is
    // the marketplace operator's mark (top header); the store logo is the
    // seller's own mark and sits with the "Sold By" identity block.
    const [platformName, platformLogoUrl] = await Promise.all([
      this.siteSettings
        .findByKey('platform_name')
        .then((s) => (s?.value ? s.value : null))
        .catch(() => null),
      this.siteSettings
        .findByKey('platform_logo_url')
        .then((s) => s?.value ?? null)
        .catch(() => null),
    ]);
    const [platformLogoDataUri, storeLogoDataUri] = await Promise.all([
      this.resolveLogoDataUri(platformLogoUrl),
      this.resolveLogoDataUri(so.store?.logoUrl ?? null),
    ]);

    return {
      invoiceNumber,
      invoiceDate,
      platform: {
        name:
          platformName ??
          this.config.get<string>('PLATFORM_NAME', 'MultiMart'),
        logoDataUri: platformLogoDataUri,
      },
      store: {
        logoDataUri: storeLogoDataUri,
      },
      order: {
        orderNumber: order.orderNumber,
        buyerGstin: order.buyerGstin,
      },
      placeOfSupply: {
        code: so.placeOfSupplyStateCode ?? '—',
        name: so.placeOfSupplyStateName ?? '—',
      },
      seller: {
        id: so.seller.id,
        legalName: so.seller.legalName,
        panNumber: so.seller.panNumber,
        gstin: so.seller.gstin,
        stateCode: so.seller.stateCode,
        stateName: so.seller.stateName,
      },
      billing: {
        name: customerUser.name,
        line1: billingAddr?.addressLine1 ?? '',
        line2: billingAddr?.addressLine2 ?? '',
        city: billingAddr?.city ?? '',
        state: billingAddr?.state ?? '',
        postalCode: billingAddr?.postalCode ?? '',
      },
      shipping: {
        name: customerUser.name,
        line1: shippingAddr?.addressLine1 ?? '',
        line2: shippingAddr?.addressLine2 ?? '',
        city: shippingAddr?.city ?? '',
        state: shippingAddr?.state ?? '',
        postalCode: shippingAddr?.postalCode ?? '',
      },
      items,
      totals,
      isIntraState,
      hasCess,
      discount: {
        amount: Number(so.discountAmount),
        couponCode: order.couponCode,
      },
      amountInWords: numberToIndianWords(totals.grandTotal),
      grievance: this.grievanceFromConfig(),
    };
  }

  private grievanceFromConfig() {
    const name = this.config.get<string>('GRIEVANCE_OFFICER_NAME');
    const email = this.config.get<string>('GRIEVANCE_OFFICER_EMAIL');
    const phone = this.config.get<string>('GRIEVANCE_OFFICER_PHONE');
    if (!name && !email) return null;
    return { name, email, phone };
  }

  /**
   * Fetch a logo URL and return it as a base64 `data:` URI for inlining into
   * the invoice HTML.
   *
   * The PDF renderer (`renderPdf`) uses `waitUntil: 'domcontentloaded'` and does
   * NOT load external resources, so a remote `<img src="http…">` would render
   * blank. Inlining as a data URI is the only reliable path. Results are cached
   * in-memory (keyed by URL) so the platform logo is fetched + encoded once and
   * reused across every invoice.
   *
   * Robust by design: a missing/broken/oversized/slow logo resolves to `null`
   * so the template falls back to text and PDF generation never hard-fails.
   */
  private async resolveLogoDataUri(url: string | null): Promise<string | null> {
    if (!url || !url.trim()) return null;

    const now = Date.now();
    const cached = this.logoCache.get(url);
    if (cached && cached.expiresAt > now) return cached.dataUri;

    let dataUri: string | null = null;
    try {
      // Only fetch over http(s) — guards against file://, data:, etc. (SSRF).
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('unsupported URL scheme');
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        InvoiceService.LOGO_FETCH_TIMEOUT_MS,
      );
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) {
        throw new Error(`non-image content-type: ${contentType}`);
      }

      const raw = Buffer.from(await res.arrayBuffer());
      if (raw.byteLength > InvoiceService.LOGO_MAX_BYTES) {
        throw new Error(`logo too large: ${raw.byteLength} bytes`);
      }

      // Normalise via sharp: bound the dimensions (PDF size), strip metadata,
      // and emit PNG so transparency is preserved against the white invoice.
      const png = await sharp(raw)
        .resize({
          width: InvoiceService.LOGO_MAX_WIDTH,
          withoutEnlargement: true,
          fit: 'inside',
        })
        .png()
        .toBuffer();
      dataUri = `data:image/png;base64,${png.toString('base64')}`;
    } catch (err) {
      this.logger.warn(
        `Could not inline logo "${url}": ${(err as Error).message}. Falling back to text.`,
      );
      dataUri = null;
    }

    this.logoCache.set(url, {
      dataUri,
      expiresAt: now + InvoiceService.LOGO_CACHE_TTL_MS,
    });
    return dataUri;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Render the invoice HTML from the DB-backed template (admin-editable).
   *
   * Reads the `tax_invoice` InvoiceTemplate row and compiles its htmlBody +
   * css with the per-order context. Falls back to the shipped default
   * constants if the row is missing (unseeded DB) so generation never
   * hard-fails. Compiles per call so admin edits take effect immediately —
   * invoice volume is low, so the compile cost is negligible.
   */
  private async renderHtml(ctx: InvoiceContext): Promise<string> {
    const row = await this.templates.getByKey(TAX_INVOICE_TEMPLATE_KEY);
    const htmlBody = row?.htmlBody ?? DEFAULT_TAX_INVOICE_HBS;
    const css = row?.css ?? DEFAULT_TAX_INVOICE_CSS;
    return Handlebars.compile(htmlBody)({ ...ctx, css });
  }

  /**
   * Render arbitrary (unsaved) HBS + CSS against a SAMPLE invoice context.
   * Powers the admin editor's live preview. Returns HTML (no PDF).
   */
  previewHtml(htmlBody: string, css: string): string {
    return Handlebars.compile(htmlBody)({ ...SAMPLE_INVOICE_CONTEXT, css });
  }

  private async renderPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // `domcontentloaded` is fast and sufficient — we don't load any
      // external resources (fonts/images are inlined).
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '12mm', bottom: '15mm', left: '12mm' },
      });
      return Buffer.from(pdf);
    } catch (err) {
      this.logger.error(`PDF render failed: ${(err as Error).message}`);
      throw new InternalServerErrorException('Failed to render invoice PDF');
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async getBrowser(): Promise<puppeteer.Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }
    // In Docker we install system Chromium and point puppeteer at it via
    // `PUPPETEER_EXECUTABLE_PATH` so the slim base image doesn't have to
    // host the ~200 MB bundled Chrome. Local dev falls through to the
    // default (puppeteer-managed) binary.
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    this.browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    return this.browser;
  }

  // ---------------------------------------------------------------------------
  // Handlebars helpers
  // ---------------------------------------------------------------------------

  private registerHelpers() {
    // Display money as Indian-grouped 2dp string. No currency symbol —
    // the template inlines the ₹.
    Handlebars.registerHelper('money', (value: unknown) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return '0.00';
      return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    });

    // dd Mmm yyyy — short, unambiguous, no locale surprises.
    Handlebars.registerHelper('formatDate', (value: unknown) => {
      if (!(value instanceof Date)) return '';
      return value.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    });

    Handlebars.registerHelper('addOne', (idx: number) => idx + 1);
  }
}

// ---------------------------------------------------------------------------
// Template context shape (kept in this file so it's reviewed alongside
// the Handlebars template that consumes it).
// ---------------------------------------------------------------------------

interface InvoiceContext {
  invoiceNumber: string;
  invoiceDate: Date;
  platform: { name: string; logoDataUri: string | null };
  store: { logoDataUri: string | null };
  order: { orderNumber: string; buyerGstin: string | null };
  placeOfSupply: { code: string; name: string };
  seller: {
    id: string;
    legalName: string;
    panNumber: string;
    gstin: string | null;
    stateCode: string | null;
    stateName: string | null;
  };
  billing: AddressBlock;
  shipping: AddressBlock;
  items: InvoiceItem[];
  totals: {
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    cess: number;
    shipping: number;
    grandTotal: number;
  };
  isIntraState: boolean;
  hasCess: boolean;
  discount: { amount: number; couponCode: string | null };
  amountInWords: string;
  grievance: { name?: string; email?: string; phone?: string } | null;
}

interface AddressBlock {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
}

interface InvoiceItem {
  name: string;
  variantName: string | null;
  sku: string;
  hsnCode: string;
  countryOfOrigin: string;
  quantity: number;
  unitPrice: number;
  taxableValue: number;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  cessRate: number;
  cessAmount: number;
  lineTotal: number;
}

/**
 * Representative sample context for the admin live preview. Two intra-state
 * line items (CGST+SGST) so the editor shows a realistic invoice. Uses a
 * fixed date so the preview is deterministic.
 */
const SAMPLE_INVOICE_CONTEXT: InvoiceContext = {
  invoiceNumber: 'INV/FY26-27/A1B2/000001',
  invoiceDate: new Date('2026-05-31T00:00:00Z'),
  platform: { name: 'MultiMart', logoDataUri: null },
  store: { logoDataUri: null },
  order: { orderNumber: 'ORD-2026-05-000123', buyerGstin: null },
  placeOfSupply: { code: '27', name: 'Maharashtra' },
  seller: {
    id: 'sample-seller',
    legalName: 'Demo Seller Pvt Ltd',
    panNumber: 'ABCDE1234F',
    gstin: '27ABCDE1234F1Z5',
    stateCode: '27',
    stateName: 'Maharashtra',
  },
  billing: {
    name: 'Demo Customer',
    line1: '45 MG Road',
    line2: null,
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411001',
  },
  shipping: {
    name: 'Demo Customer',
    line1: '45 MG Road',
    line2: null,
    city: 'Pune',
    state: 'Maharashtra',
    postalCode: '411001',
  },
  items: [
    {
      name: 'Aurora Wireless Headphones',
      variantName: null,
      sku: 'DEMO-AUR-HP-001',
      hsnCode: '8518',
      countryOfOrigin: 'IN',
      quantity: 1,
      unitPrice: 2999,
      taxableValue: 2541.53,
      cgstRate: 9,
      cgstAmount: 228.74,
      sgstRate: 9,
      sgstAmount: 228.74,
      igstRate: 0,
      igstAmount: 0,
      cessRate: 0,
      cessAmount: 0,
      lineTotal: 2999,
    },
    {
      name: 'Nimbus Cotton T-Shirt',
      variantName: 'Blue / M',
      sku: 'DEMO-NIM-TS-002',
      hsnCode: '6109',
      countryOfOrigin: 'IN',
      quantity: 2,
      unitPrice: 599,
      taxableValue: 1069.64,
      cgstRate: 6,
      cgstAmount: 64.18,
      sgstRate: 6,
      sgstAmount: 64.18,
      igstRate: 0,
      igstAmount: 0,
      cessRate: 0,
      cessAmount: 0,
      lineTotal: 1198,
    },
  ],
  totals: {
    taxableValue: 3611.17,
    cgst: 292.92,
    sgst: 292.92,
    igst: 0,
    cess: 0,
    shipping: 0,
    grandTotal: 4197,
  },
  isIntraState: true,
  hasCess: false,
  discount: { amount: 0, couponCode: null },
  amountInWords: 'Rupees Four thousand one hundred ninety-seven only',
  grievance: {
    name: 'Grievance Officer',
    email: 'grievance@multimart.example',
    phone: '+91-1800-000-000',
  },
};
