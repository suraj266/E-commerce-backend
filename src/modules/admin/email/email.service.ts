/**
 * EmailService — central send pipeline.
 *
 * Flow:
 *   1. App code calls `email.send("password_reset", to, { user, link })`.
 *   2. We load the template by key, check it's enabled, render subject+body
 *      via Handlebars with the supplied context (and the shared header/footer
 *      partials when present).
 *   3. We pull SMTP creds from EmailConfigService (decrypts the password
 *      internally), build a nodemailer transporter, and send.
 *   4. Every attempt — success or failure — is recorded in EmailLog.
 *
 * Failure modes are deliberately soft: when SMTP isn't configured or the
 * template is disabled, we log a warning and return `{ skipped: true }`
 * rather than throwing. The caller (e.g. password reset) decides whether
 * that's a hard error in its own context.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

import { PrismaService } from '@/prisma/prisma.service';
import { SiteSettingService } from '@/modules/admin/site-setting/site-setting.service';
import { EmailConfigService } from './email-config.service';

export interface SendEmailContext {
  // Caller-supplied template variables. Handlebars renders these into the
  // subject + html + text bodies.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface SendEmailResult {
  sent: boolean;
  /** True when we deliberately skipped (e.g. SMTP unconfigured, template off). */
  skipped?: boolean;
  /** Reason for skip OR the error message on failure. */
  message?: string;
  logId?: string;
}

interface BrandingContext {
  shopName: string;
  logoUrl: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  // Branding (brand name + logo URL) rarely changes, so cache it briefly to
  // avoid two SiteSetting reads on every send. Short TTL keeps admin edits
  // visible within a minute.
  private brandingCache: { value: BrandingContext; expiresAt: number } | null =
    null;
  private static readonly BRANDING_CACHE_TTL_MS = 60 * 1000; // 60 seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EmailConfigService,
    private readonly siteSettings: SiteSettingService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Render a template by key and dispatch it.
   *
   * Soft-fails (returns `{ sent: false, skipped: true }`) when:
   *   - SMTP is not configured
   *   - Template doesn't exist
   *   - Template is disabled
   *
   * Hard-fails (returns `{ sent: false }` with `message`) when:
   *   - Render error
   *   - Transport / SMTP error
   */
  async send(
    templateKey: string,
    to: string,
    context: SendEmailContext = {},
  ): Promise<SendEmailResult> {
    const setting = await this.config.findGlobal();
    if (!setting.isConfigured) {
      this.logger.warn(
        `Skipped sending "${templateKey}" — SMTP is not configured.`,
      );
      return {
        sent: false,
        skipped: true,
        message: 'SMTP is not configured. Configure it in Admin → Email Settings.',
      };
    }

    const template = await this.prisma.emailTemplate.findUnique({
      where: { key: templateKey },
    });
    if (!template) {
      this.logger.warn(`Skipped sending — template "${templateKey}" not found.`);
      return {
        sent: false,
        skipped: true,
        message: `Template "${templateKey}" does not exist. Run pnpm seed:emails.`,
      };
    }
    if (!template.isEnabled) {
      this.logger.log(
        `Skipped sending "${templateKey}" — template is disabled by admin.`,
      );
      return {
        sent: false,
        skipped: true,
        message: `Template "${templateKey}" is disabled.`,
      };
    }

    // Inject global branding (shopName + logoUrl) from SiteSetting so every
    // template's shared header renders the admin-managed brand without each
    // caller having to pass it. Branding wins over caller-supplied keys: this
    // unifies the brand identity and overrides the legacy hardcoded shopName
    // values scattered across callers.
    const branding = await this.getBrandingContext();
    const brandedContext: SendEmailContext = { ...context, ...branding };

    let subject: string;
    let html: string;
    let text: string | undefined;
    try {
      const rendered = await this.render(template, brandedContext);
      subject = rendered.subject;
      html = rendered.html;
      text = rendered.text;
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Render failed for "${templateKey}": ${msg}`);
      const log = await this.recordLog(
        templateKey,
        to,
        template.subject,
        'FAILED',
        `Render error: ${msg}`,
        context,
      );
      return { sent: false, message: msg, logId: log.id };
    }

    return this.dispatch({
      to,
      subject,
      html,
      text,
      templateKey,
      context: brandedContext,
    });
  }

  /**
   * Resolve the global brand identity (name + logo URL) from SiteSetting.
   *
   * `logoUrl` MUST be an absolute, publicly-reachable URL for email clients to
   * render it — they cannot load `localhost` or `data:` URIs. When unset, the
   * header partial falls back to the `shopName` text. Soft-fails to sensible
   * defaults so a SiteSetting read error never blocks an email.
   */
  private async getBrandingContext(): Promise<BrandingContext> {
    const now = Date.now();
    if (this.brandingCache && this.brandingCache.expiresAt > now) {
      return this.brandingCache.value;
    }

    let value: BrandingContext = { shopName: 'Ecommerce', logoUrl: '' };
    try {
      const [name, logo] = await Promise.all([
        this.siteSettings.findByKey('platform_name'),
        this.siteSettings.findByKey('platform_logo_url'),
      ]);
      value = {
        shopName: name?.value ? name.value : 'Ecommerce',
        logoUrl: logo?.value ?? '',
      };
    } catch (err) {
      this.logger.warn(
        `Could not load branding settings: ${(err as Error).message}. Using defaults.`,
      );
    }

    this.brandingCache = {
      value,
      expiresAt: now + EmailService.BRANDING_CACHE_TTL_MS,
    };
    return value;
  }

  /**
   * Send a one-off raw message (no template). Used by the "Send test email"
   * button on the admin settings page.
   */
  async sendRaw(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<SendEmailResult> {
    const setting = await this.config.findGlobal();
    if (!setting.isConfigured) {
      return {
        sent: false,
        skipped: true,
        message: 'SMTP is not configured.',
      };
    }
    return this.dispatch({
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      templateKey: '__raw__',
      context: {},
    });
  }

  /**
   * Render-only — used by the admin "Preview" pane. Returns subject + html
   * with the current context applied. Throws on bad template.
   */
  async preview(templateKey: string, context: SendEmailContext) {
    const template = await this.prisma.emailTemplate.findUnique({
      where: { key: templateKey },
    });
    if (!template) {
      throw new Error(`Template "${templateKey}" not found.`);
    }
    return this.render(template, context);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Compile + execute Handlebars on subject, html, and (optional) text.
   * Wraps html in the global header + footer partials if they exist.
   */
  private async render(
    template: { subject: string; htmlBody: string; textBody: string | null },
    context: SendEmailContext,
  ) {
    const partials = await this.loadPartials();
    const wrappedHtml = `${partials.header ?? ''}${template.htmlBody}${partials.footer ?? ''}`;

    const subject = Handlebars.compile(template.subject)(context);
    const html = Handlebars.compile(wrappedHtml)(context);
    const text = template.textBody
      ? Handlebars.compile(template.textBody)(context)
      : stripHtml(html);

    return { subject, html, text };
  }

  /** Loads the `email_header` + `email_footer` PARTIAL templates if seeded. */
  private async loadPartials(): Promise<{
    header?: string;
    footer?: string;
  }> {
    const rows = await this.prisma.emailTemplate.findMany({
      where: { key: { in: ['email_header', 'email_footer'] } },
    });
    const out: { header?: string; footer?: string } = {};
    for (const r of rows) {
      if (r.key === 'email_header') out.header = r.htmlBody;
      if (r.key === 'email_footer') out.footer = r.htmlBody;
    }
    return out;
  }

  /** Build a fresh transporter for each send. SMTP creds rarely change so
   * no real perf hit; avoids stale-creds issues if admin updates settings. */
  private async buildTransport(): Promise<Transporter> {
    const setting = await this.config.findGlobal();
    const password = await this.config.getDecryptedPassword();

    return nodemailer.createTransport({
      host: setting.host,
      port: setting.port,
      // SSL implicit on 465, STARTTLS on 587, none for 25.
      secure: setting.encryption === 'SSL',
      requireTLS: setting.encryption === 'TLS',
      auth: {
        user: setting.username,
        pass: password,
      },
      ...(setting.localDomain ? { name: setting.localDomain } : {}),
    });
  }

  private async dispatch(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    templateKey: string;
    context: SendEmailContext;
  }): Promise<SendEmailResult> {
    const setting = await this.config.findGlobal();
    const from = setting.senderName
      ? `"${setting.senderName}" <${setting.senderEmail}>`
      : setting.senderEmail;

    try {
      const transport = await this.buildTransport();
      await transport.sendMail({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      });
      const log = await this.recordLog(
        opts.templateKey,
        opts.to,
        opts.subject,
        'SENT',
        null,
        opts.context,
      );
      this.logger.log(
        `Sent "${opts.templateKey}" to ${opts.to} (subject: ${opts.subject})`,
      );
      return { sent: true, logId: log.id };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.error(`Send failed for "${opts.templateKey}": ${msg}`);
      const log = await this.recordLog(
        opts.templateKey,
        opts.to,
        opts.subject,
        'FAILED',
        msg,
        opts.context,
      );
      return { sent: false, message: msg, logId: log.id };
    }
  }

  private async recordLog(
    templateKey: string,
    to: string,
    subject: string,
    status: 'SENT' | 'FAILED' | 'QUEUED',
    errorMessage: string | null,
    context: SendEmailContext,
  ) {
    return this.prisma.emailLog.create({
      data: {
        templateKey,
        toAddress: to,
        subject,
        status,
        errorMessage,
        contextJson: safeStringify(context),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Crude HTML→text fallback for clients that prefer plaintext. Strips tags,
 * collapses whitespace. Good enough for transactional email; admins can
 * always supply a hand-written textBody for finer control.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeStringify(obj: unknown): string | null {
  try {
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}
