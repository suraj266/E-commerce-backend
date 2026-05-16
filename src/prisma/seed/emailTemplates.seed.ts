/**
 * Seed default email templates.
 *
 * Idempotent — uses `key` as the unique identifier and only creates rows
 * that don't exist. Safe to re-run; admin edits to existing templates are
 * preserved.
 *
 * Run: pnpm seed:emails
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HEADER_HTML = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f4f5;color:#18181b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <tr><td style="padding:24px 32px;border-bottom:1px solid #e4e4e7;">
        <h1 style="margin:0;font-size:18px;font-weight:600;">{{shopName}}</h1>
      </td></tr>
      <tr><td style="padding:32px;">`;

const FOOTER_HTML = `      </td></tr>
      <tr><td style="padding:24px 32px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;text-align:center;">
        <p style="margin:0;">© {{shopName}}. This is an automated message — please do not reply.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

const templates = [
  // ---- Partials ----
  {
    key: 'email_header',
    name: 'Email header',
    description: 'Wraps the top of every email — logo, brand colors.',
    category: 'PARTIAL' as const,
    subject: '',
    htmlBody: HEADER_HTML,
    variables: ['shopName'],
    isEnabled: true,
    isSystem: true,
  },
  {
    key: 'email_footer',
    name: 'Email footer',
    description: 'Wraps the bottom of every email — copyright, unsubscribe.',
    category: 'PARTIAL' as const,
    subject: '',
    htmlBody: FOOTER_HTML,
    variables: ['shopName'],
    isEnabled: true,
    isSystem: true,
  },

  // ---- System (cannot be disabled) ----
  {
    key: 'password_reset',
    name: 'Password reset',
    description:
      'Sent when a user requests a password reset. Contains the reset link and expiry.',
    category: 'SYSTEM' as const,
    subject: 'Reset your password',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>We got a request to reset the password for your account. Click the button below to set a new one — the link expires in 1 hour.</p>
<p style="margin:24px 0;"><a href="{{resetLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Reset password</a></p>
<p style="font-size:13px;color:#71717a;">If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
    variables: ['customerName', 'resetLink', 'shopName'],
    isEnabled: true,
    isSystem: true,
  },
  {
    key: 'email_verification',
    name: 'Email verification',
    description:
      'Sent on registration to verify the user controls the email address.',
    category: 'SYSTEM' as const,
    subject: 'Verify your email address',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Welcome, {{customerName}}!</h2>
<p>Thanks for signing up. Click below to verify your email and activate your account.</p>
<p style="margin:24px 0;"><a href="{{verificationLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Verify email</a></p>
<p style="font-size:13px;color:#71717a;">This link expires in 24 hours. If you didn't create an account, you can ignore this message.</p>`,
    variables: ['customerName', 'verificationLink', 'shopName'],
    isEnabled: true,
    isSystem: true,
  },

  // ---- Auth ----
  {
    key: 'welcome',
    name: 'Welcome email',
    description: 'Friendly intro sent after a user verifies their email.',
    category: 'AUTH' as const,
    subject: 'Welcome to {{shopName}} 🎉',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Welcome aboard, {{customerName}}!</h2>
<p>Your account is set up and ready. You can now browse products, save favourites to your wishlist, and check out faster.</p>
<p>Happy shopping!</p>`,
    variables: ['customerName', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },

  // ---- Order ----
  {
    key: 'order_placed',
    name: 'Order placed (customer)',
    description: 'Sent to the customer right after they place an order.',
    category: 'ORDER' as const,
    subject: 'Order #{{orderNumber}} confirmed',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Thanks for your order, {{customerName}}!</h2>
<p>We've received order <strong>#{{orderNumber}}</strong> for <strong>{{totalAmount}}</strong>. We'll email you again when each seller confirms and ships your items.</p>
<p style="margin:24px 0;"><a href="{{orderLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">View order</a></p>`,
    variables: ['customerName', 'orderNumber', 'totalAmount', 'orderLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'order_confirmed',
    name: 'Order confirmed by seller',
    description: 'Sent when a seller acknowledges and prepares an order.',
    category: 'ORDER' as const,
    subject: 'Your order #{{orderNumber}} is being prepared',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>{{sellerName}} has confirmed your order and is preparing it for shipment.</p>
<p style="margin:24px 0;"><a href="{{orderLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Track order</a></p>`,
    variables: ['customerName', 'orderNumber', 'sellerName', 'orderLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'order_shipped',
    name: 'Order shipped',
    description: 'Sent when a seller marks an order as shipped (with tracking).',
    category: 'ORDER' as const,
    subject: 'Your order #{{orderNumber}} has shipped',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Good news, {{customerName}}!</h2>
<p>{{sellerName}} has shipped your order. Tracking number: <strong>{{trackingNumber}}</strong></p>
<p style="margin:24px 0;"><a href="{{trackingLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Track shipment</a></p>`,
    variables: ['customerName', 'orderNumber', 'sellerName', 'trackingNumber', 'trackingLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'order_delivered',
    name: 'Order delivered',
    description: 'Sent when an order is marked delivered.',
    category: 'ORDER' as const,
    subject: 'Order #{{orderNumber}} delivered',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">It's here, {{customerName}}!</h2>
<p>Your order <strong>#{{orderNumber}}</strong> has been delivered. We hope you love it.</p>
<p>Have feedback? Reply to this email or leave a review on the product page.</p>`,
    variables: ['customerName', 'orderNumber', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'order_cancelled',
    name: 'Order cancelled',
    description: 'Sent when an order or seller-order slice is cancelled.',
    category: 'ORDER' as const,
    subject: 'Order #{{orderNumber}} cancelled',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>Your order <strong>#{{orderNumber}}</strong> has been cancelled. {{cancellationReason}}</p>
<p>Any payment will be refunded to the original method within 5–7 business days.</p>`,
    variables: ['customerName', 'orderNumber', 'cancellationReason', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'order_refunded',
    name: 'Order refunded',
    description: 'Sent when a refund is processed.',
    category: 'ORDER' as const,
    subject: 'Refund processed for order #{{orderNumber}}',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>We've processed a refund of <strong>{{refundAmount}}</strong> for order <strong>#{{orderNumber}}</strong>. It'll appear on your statement within 5–7 business days.</p>`,
    variables: ['customerName', 'orderNumber', 'refundAmount', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },

  // ---- Seller ----
  {
    key: 'seller_new_order',
    name: 'New order alert (seller)',
    description: 'Notifies a seller they have a new order to fulfill.',
    category: 'SELLER' as const,
    subject: 'New order #{{orderNumber}} — action required',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{sellerName}},</h2>
<p>You have a new order to fulfill. Please confirm it within 24 hours so the customer doesn't get worried.</p>
<p><strong>Order:</strong> #{{orderNumber}}<br/>
<strong>Items:</strong> {{itemCount}}<br/>
<strong>Subtotal:</strong> {{subtotal}}</p>
<p style="margin:24px 0;"><a href="{{orderLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Open order</a></p>`,
    variables: ['sellerName', 'orderNumber', 'itemCount', 'subtotal', 'orderLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'seller_kyc_approved',
    name: 'Seller KYC approved',
    description: 'Sent when a seller passes KYC verification.',
    category: 'SELLER' as const,
    subject: 'Your seller account is verified ✅',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Welcome to {{shopName}}, {{sellerName}}!</h2>
<p>Your KYC has been approved. You can now list products and start accepting orders.</p>
<p style="margin:24px 0;"><a href="{{dashboardLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Open seller dashboard</a></p>`,
    variables: ['sellerName', 'dashboardLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'seller_kyc_rejected',
    name: 'Seller KYC rejected',
    description: 'Sent when KYC submission is rejected; includes the reason.',
    category: 'SELLER' as const,
    subject: 'Your seller application needs attention',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{sellerName}},</h2>
<p>We reviewed your seller application and need to follow up before we can approve it.</p>
<p><strong>Reason:</strong> {{rejectionReason}}</p>
<p>Please update the relevant documents and resubmit. Reply to this email if you have questions.</p>`,
    variables: ['sellerName', 'rejectionReason', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'seller_payout_disbursed',
    name: 'Seller payout disbursed',
    description: 'Notifies a seller that their payout has been transferred.',
    category: 'SELLER' as const,
    subject: 'Payout of {{payoutAmount}} sent',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{sellerName}},</h2>
<p>We've transferred <strong>{{payoutAmount}}</strong> to your registered bank account for the period <strong>{{periodLabel}}</strong>. Funds typically arrive within 1–2 business days.</p>`,
    variables: ['sellerName', 'payoutAmount', 'periodLabel', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },

  // ---- Admin ----
  {
    key: 'admin_new_seller',
    name: 'New seller signup (admin alert)',
    description: 'Pings admin when a new seller registers and starts onboarding.',
    category: 'ADMIN' as const,
    subject: 'New seller signup: {{sellerName}}',
    htmlBody: `<p>A new seller has joined and started onboarding:</p>
<p><strong>Name:</strong> {{sellerName}}<br/>
<strong>Email:</strong> {{sellerEmail}}<br/>
<strong>Business type:</strong> {{businessType}}</p>
<p style="margin:24px 0;"><a href="{{reviewLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Review application</a></p>`,
    variables: ['sellerName', 'sellerEmail', 'businessType', 'reviewLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'admin_new_contact',
    name: 'New contact form submission',
    description: 'Notifies admin of a new contact form submission.',
    category: 'ADMIN' as const,
    subject: 'New contact form submission from {{senderName}}',
    htmlBody: `<p>You've received a new message via the contact form:</p>
<p><strong>From:</strong> {{senderName}} ({{senderEmail}})<br/>
<strong>Subject:</strong> {{messageSubject}}</p>
<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #e4e4e7;color:#52525b;">{{messageBody}}</blockquote>`,
    variables: ['senderName', 'senderEmail', 'messageSubject', 'messageBody', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'admin_new_review',
    name: 'New review pending moderation',
    description: 'Notifies admin when a customer submits a review for approval.',
    category: 'ADMIN' as const,
    subject: 'Review pending: {{productName}} ({{rating}}★)',
    htmlBody: `<p>A new product review is waiting for moderation.</p>
<p><strong>Product:</strong> {{productName}}<br/>
<strong>Reviewer:</strong> {{customerName}}<br/>
<strong>Rating:</strong> {{rating}} / 5</p>
{{#if title}}<p><strong>Title:</strong> {{title}}</p>{{/if}}
<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #e4e4e7;color:#52525b;">{{body}}</blockquote>
<p style="margin:24px 0;"><a href="{{reviewLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Open moderation queue</a></p>`,
    variables: ['productName', 'customerName', 'rating', 'title', 'body', 'reviewLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },

  // ---- Customer review lifecycle ----
  {
    key: 'review_approved',
    name: 'Review approved',
    description: 'Sent to the customer when an admin approves their review.',
    category: 'AUTH' as const,
    subject: 'Your review is live on {{productName}}',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Thanks, {{customerName}}!</h2>
<p>Your review of <strong>{{productName}}</strong> is now visible to other customers. Thank you for sharing your experience.</p>
<p style="margin:24px 0;"><a href="{{productLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">See your review</a></p>`,
    variables: ['customerName', 'productName', 'productLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'review_rejected',
    name: 'Review needs changes',
    description: 'Sent to the customer when an admin rejects their review.',
    category: 'AUTH' as const,
    subject: 'Your review of {{productName}} needs changes',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>We couldn't publish your review of <strong>{{productName}}</strong> as-is.</p>
{{#if reason}}<p><strong>Reason:</strong> {{reason}}</p>{{/if}}
<p>You're welcome to edit and resubmit — once you make changes, the updated review will go through the same approval flow.</p>
<p style="margin:24px 0;"><a href="{{productLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Edit your review</a></p>`,
    variables: ['customerName', 'productName', 'reason', 'productLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },

  // ---- Newsletter ----
  {
    key: 'newsletter_confirmation',
    name: 'Newsletter subscription confirmation',
    description: 'Confirms a customer is subscribed to the newsletter.',
    category: 'NEWSLETTER' as const,
    subject: "You're subscribed to {{shopName}}",
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Welcome!</h2>
<p>You'll start hearing from us when there's something worth sharing — new arrivals, sales, occasional behind-the-scenes notes.</p>
<p style="font-size:13px;color:#71717a;">Don't want these? <a href="{{unsubscribeLink}}" style="color:#71717a;">Unsubscribe here</a> any time.</p>`,
    variables: ['unsubscribeLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const t of templates) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { key: t.key },
    });
    if (!existing) {
      await prisma.emailTemplate.create({ data: t });
      created++;
    } else {
      // Don't overwrite admin edits — only refresh `description` (metadata)
      // and preserve every other field. Admins own the content.
      await prisma.emailTemplate.update({
        where: { key: t.key },
        data: { description: t.description },
      });
      updated++;
    }
  }

  console.log(
    `✓ Email templates: ${created} created, ${updated} description-refreshed (existing bodies preserved).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
