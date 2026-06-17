/**
 * Shared email header/footer partial bodies.
 *
 * Single source of truth for the `email_header` / `email_footer` PARTIAL
 * templates. Imported by:
 *   1. `emailTemplates.seed.ts` — seeds the rows on a fresh DB.
 *   2. `updateEmailHeaderBranding.ts` — force-updates the header on an
 *      already-seeded DB (the normal seed preserves existing bodies).
 *
 * Branding variables (`shopName`, `logoUrl`) are injected centrally by
 * `EmailService.send()` from SiteSetting, so callers never pass them. The
 * header renders the logo image when `logoUrl` is set, else the brand text.
 * NOTE: email clients cannot load `data:`/`localhost` images — `logoUrl` must
 * be an absolute, publicly-reachable URL to render in real inboxes.
 */

export const EMAIL_HEADER_HTML = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;color:#18181b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;">
        {{#if logoUrl}}<img src="{{logoUrl}}" alt="{{shopName}}" style="max-height:40px;max-width:200px;display:block;border:0;">{{else}}<h1 style="margin:0;font-size:18px;font-weight:600;">{{shopName}}</h1>{{/if}}
      </td></tr>
      <tr><td style="padding:32px;">`;

export const EMAIL_FOOTER_HTML = `      </td></tr>
      <tr><td style="padding:24px 32px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;text-align:center;">
        <p style="margin:0;">© {{shopName}}. This is an automated message — please do not reply.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

/** Handlebars variables available to the header/footer partials. */
export const EMAIL_HEADER_VARIABLES = ['shopName', 'logoUrl'];
export const EMAIL_FOOTER_VARIABLES = ['shopName'];
