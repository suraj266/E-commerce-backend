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
import {
  EMAIL_HEADER_HTML as HEADER_HTML,
  EMAIL_FOOTER_HTML as FOOTER_HTML,
  EMAIL_HEADER_VARIABLES,
  EMAIL_FOOTER_VARIABLES,
} from './email-partials';

const prisma = new PrismaClient();

const templates = [
  // ---- Partials ----
  {
    key: 'email_header',
    name: 'Email header',
    description: 'Wraps the top of every email — logo, brand colors.',
    category: 'PARTIAL' as const,
    subject: '',
    htmlBody: HEADER_HTML,
    variables: EMAIL_HEADER_VARIABLES,
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
    variables: EMAIL_FOOTER_VARIABLES,
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
  {
    key: 'data_export_ready',
    name: 'Data export ready (DPDP)',
    description:
      'Sent when a customer-requested DPDP data export bundle is ready to download. Compliance email — never marketing-gated. The link expires for privacy.',
    category: 'SYSTEM' as const,
    subject: 'Your data export is ready to download',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>The copy of your personal data you requested is ready. Download it using the secure link below — it expires in {{expiresInHours}} hours (on {{expiresAt}}) for your privacy.</p>
<p style="margin:24px 0;"><a href="{{downloadLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Download my data</a></p>
<p style="font-size:13px;color:#71717a;">If the link has expired, you can request a fresh export any time from your account privacy settings. If you didn't request this, please contact support.</p>`,
    variables: ['customerName', 'downloadLink', 'expiresInHours', 'expiresAt', 'shopName'],
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

  // ---- Returns / RMA (P3-02) ----
  {
    key: 'return_approved',
    name: 'Return approved',
    description: 'Sent when a seller approves a return request (P3-02).',
    category: 'ORDER' as const,
    subject: 'Return {{returnNumber}} approved',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>{{message}}</p>
<p style="margin:24px 0;"><a href="{{returnLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Track your return</a></p>`,
    variables: ['customerName', 'returnNumber', 'message', 'returnLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'return_received',
    name: 'Return received',
    description: 'Sent when returned items are received and inspection begins (P3-02).',
    category: 'ORDER' as const,
    subject: 'We received your return {{returnNumber}}',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>{{message}}</p>
<p style="margin:24px 0;"><a href="{{returnLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Track your return</a></p>`,
    variables: ['customerName', 'returnNumber', 'message', 'returnLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'return_refunded',
    name: 'Return refunded',
    description: 'Sent when a QC-passed return is refunded (P3-02).',
    category: 'ORDER' as const,
    subject: 'Refund processed for return {{returnNumber}}',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>{{message}}</p>
<p>It'll appear on your original payment method within 5–7 business days.</p>
<p style="margin:24px 0;"><a href="{{returnLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">View return</a></p>`,
    variables: ['customerName', 'returnNumber', 'message', 'returnLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'return_replacement_approved',
    name: 'Return replacement approved',
    description:
      'Sent when a QC-passed return is resolved as a REPLACEMENT — a swap unit is being prepared, no refund (Phase 3 Wave 4).',
    category: 'ORDER' as const,
    subject: 'Replacement approved for return {{returnNumber}}',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Hi {{customerName}},</h2>
<p>{{message}}</p>
<p>We'll email you again with the details once your replacement ships.</p>
<p style="margin:24px 0;"><a href="{{returnLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Track your return</a></p>`,
    variables: ['customerName', 'returnNumber', 'message', 'returnLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
  {
    key: 'return_replacement_shipped',
    name: 'Return replacement shipped',
    description:
      'Sent when the seller ships the replacement unit for a REPLACEMENT return (Phase 3 Wave 4).',
    category: 'ORDER' as const,
    subject: 'Your replacement for return {{returnNumber}} has shipped',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Good news, {{customerName}}!</h2>
<p>{{message}}</p>
<p style="margin:24px 0;"><a href="{{returnLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">View return</a></p>`,
    variables: ['customerName', 'returnNumber', 'message', 'returnLink', 'shopName'],
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

  {
    key: 'courier_alert',
    name: 'Courier NDR/RTO alert (seller + ops)',
    description:
      'Operational alert sent to the seller and the ops inbox when a courier reports a Non-Delivery (NDR) or Return-to-Origin (RTO) exception, so a human can intervene before the parcel is lost or auto-returned.',
    category: 'SELLER' as const,
    subject: '⚠️ {{statusLabel}} on order #{{orderNumber}} — action needed',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Courier exception: {{statusLabel}}</h2>
<p>Hi {{sellerName}}, the courier has reported a <strong>{{status}}</strong> exception on order <strong>#{{orderNumber}}</strong>. This shipment needs attention.</p>
<table role="presentation" style="margin:16px 0;border-collapse:collapse;font-size:14px;">
  <tr><td style="padding:4px 12px 4px 0;color:#71717a;">Order</td><td style="padding:4px 0;"><strong>#{{orderNumber}}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#71717a;">AWB / Tracking</td><td style="padding:4px 0;"><strong>{{awb}}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#71717a;">Carrier</td><td style="padding:4px 0;">{{carrier}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#71717a;">Status</td><td style="padding:4px 0;"><strong>{{statusLabel}}</strong></td></tr>
</table>
<p style="margin:16px 0;padding:12px 16px;border-left:3px solid #f59e0b;background:#fffbeb;color:#92400e;"><strong>Next step:</strong> {{nextAction}}</p>
<p style="margin:24px 0;"><a href="{{orderLink}}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;font-weight:500;">Open order</a>
&nbsp;<a href="{{trackingLink}}" style="display:inline-block;padding:12px 24px;background:#fff;color:#18181b;border:1px solid #e4e4e7;text-decoration:none;border-radius:6px;font-weight:500;">Track shipment</a></p>
<p style="font-size:13px;color:#71717a;">This is an automated operational alert. If the exception is already resolved, no further action is needed.</p>`,
    variables: [
      'sellerName',
      'orderNumber',
      'awb',
      'carrier',
      'status',
      'statusLabel',
      'nextAction',
      'trackingLink',
      'orderLink',
      'shopName',
    ],
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
    key: 'newsletter_confirm',
    name: 'Newsletter double opt-in',
    description:
      'Double opt-in: asks a new subscriber to click a link to confirm their newsletter subscription (P3-08).',
    category: 'NEWSLETTER' as const,
    subject: 'Confirm your subscription to {{shopName}}',
    htmlBody: `<h2 style="margin:0 0 16px;font-size:20px;">Confirm your subscription</h2>
<p>Thanks for signing up! Please confirm your email address to start receiving updates from {{shopName}}.</p>
<p style="margin:24px 0;"><a href="{{confirmLink}}" style="display:inline-block;padding:12px 20px;background:#4f46e5;color:#ffffff;border-radius:6px;text-decoration:none;">Confirm subscription</a></p>
<p style="font-size:13px;color:#71717a;">If you didn't request this, you can safely ignore this email — you won't be subscribed unless you confirm.</p>`,
    variables: ['confirmLink', 'shopName'],
    isEnabled: true,
    isSystem: false,
  },
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
  {
    // Wrapper for admin-composed broadcast campaigns (Phase 3 Wave 4). The admin
    // HTML is injected raw via triple-brace so it isn't escaped; header/footer
    // partials wrap it and the consent-safe unsubscribe link is always appended.
    key: 'newsletter_campaign',
    name: 'Newsletter broadcast campaign',
    description:
      'Wrapper template for admin-composed newsletter broadcasts — injects the campaign body and appends the unsubscribe link.',
    category: 'NEWSLETTER' as const,
    subject: '{{subject}}',
    htmlBody: `{{{body}}}
<p style="margin-top:32px;font-size:12px;color:#71717a;">You're receiving this because you subscribed to {{shopName}}. <a href="{{unsubscribeLink}}" style="color:#71717a;">Unsubscribe</a>.</p>`,
    variables: ['subject', 'body', 'unsubscribeLink', 'shopName'],
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
