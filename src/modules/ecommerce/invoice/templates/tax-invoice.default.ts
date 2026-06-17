/**
 * Canonical default tax-invoice template (Handlebars HTML + CSS).
 *
 * This is the SINGLE SOURCE OF TRUTH for the built-in invoice template. It is
 * used in two places:
 *   1. `invoiceTemplates.seed.ts` upserts these into the `InvoiceTemplate`
 *      DB row (`key='tax_invoice'`) — the version admins then edit in place.
 *   2. `InvoiceService.renderHtml()` falls back to these constants if the DB
 *      row is missing, so generation never hard-fails on an unseeded DB.
 *
 * At request time the renderer reads the DB row (not this file), so there is
 * NO `readFileSync` in the hot path — eliminating the prior ENOENT failure
 * where `.hbs`/`.css` assets weren't copied into `dist/`.
 *
 * Context variables + helpers available to the template are documented in
 * `TAX_INVOICE_VARIABLES` below and registered in `InvoiceService`
 * (`money`, `formatDate`, `addOne`).
 */

export const DEFAULT_TAX_INVOICE_HBS = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Tax Invoice {{invoiceNumber}}</title>
  <style>{{{css}}}</style>
</head>
<body>
<div class="invoice">

  {{!-- =========================== Header =========================== --}}
  <header class="invoice-header">
    <div class="brand">
      {{#if platform.logoDataUri}}
        <img class="platform-logo" src="{{platform.logoDataUri}}" alt="{{platform.name}}">
      {{else}}
        <div class="platform-name">{{platform.name}}</div>
      {{/if}}
      <div class="platform-tag">Marketplace operator — invoice issued by seller below</div>
    </div>
    <div class="meta">
      <h1>TAX INVOICE</h1>
      <div class="meta-row"><span class="label">Invoice No.:</span> {{invoiceNumber}}</div>
      <div class="meta-row"><span class="label">Invoice Date:</span> {{formatDate invoiceDate}}</div>
      <div class="meta-row"><span class="label">Order No.:</span> {{order.orderNumber}}</div>
      <div class="meta-row"><span class="label">Place of Supply:</span> {{placeOfSupply.name}} ({{placeOfSupply.code}})</div>
    </div>
  </header>

  {{!-- =========================== Parties =========================== --}}
  <section class="parties">
    <div class="party">
      <h3>Sold By</h3>
      {{#if store.logoDataUri}}<img class="store-logo" src="{{store.logoDataUri}}" alt="{{seller.legalName}}">{{/if}}
      <p>
        <strong>{{seller.legalName}}</strong><br>
        {{#if seller.gstin}}<span class="gstin">GSTIN {{seller.gstin}}</span><br>{{/if}}
        PAN: <span class="gstin">{{seller.panNumber}}</span><br>
        {{#if seller.stateName}}State: {{seller.stateName}} ({{seller.stateCode}}){{/if}}
      </p>
    </div>

    <div class="party">
      <h3>Bill To</h3>
      <p>
        <strong>{{billing.name}}</strong><br>
        {{#if order.buyerGstin}}<span class="gstin">GSTIN {{order.buyerGstin}}</span><br>{{/if}}
        {{billing.line1}}{{#if billing.line2}}, {{billing.line2}}{{/if}}<br>
        {{billing.city}}, {{billing.state}} {{billing.postalCode}}
      </p>
    </div>

    <div class="party">
      <h3>Ship To</h3>
      <p>
        <strong>{{shipping.name}}</strong><br>
        {{shipping.line1}}{{#if shipping.line2}}, {{shipping.line2}}{{/if}}<br>
        {{shipping.city}}, {{shipping.state}} {{shipping.postalCode}}
      </p>
    </div>
  </section>

  {{!-- =========================== Line items =========================== --}}
  <table class="items">
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Description</th>
        <th>HSN</th>
        <th>Origin</th>
        <th class="num">Qty</th>
        <th class="num">Unit (₹)</th>
        <th class="num">Taxable (₹)</th>
        {{#if isIntraState}}
          <th class="num">CGST</th>
          <th class="num">SGST</th>
        {{else}}
          <th class="num">IGST</th>
        {{/if}}
        {{#if hasCess}}<th class="num">Cess</th>{{/if}}
        <th class="num">Total (₹)</th>
      </tr>
    </thead>
    <tbody>
      {{#each items}}
      <tr>
        <td class="num">{{addOne @index}}</td>
        <td>
          {{name}}
          {{#if variantName}}<span class="variant">{{variantName}}</span>{{/if}}
          <span class="variant">SKU: {{sku}}</span>
        </td>
        <td>{{hsnCode}}</td>
        <td>{{countryOfOrigin}}</td>
        <td class="num">{{quantity}}</td>
        <td class="num">{{money unitPrice}}</td>
        <td class="num">{{money taxableValue}}</td>
        {{#if ../isIntraState}}
          <td class="num">{{money cgstAmount}}<br><small>{{cgstRate}}%</small></td>
          <td class="num">{{money sgstAmount}}<br><small>{{sgstRate}}%</small></td>
        {{else}}
          <td class="num">{{money igstAmount}}<br><small>{{igstRate}}%</small></td>
        {{/if}}
        {{#if ../hasCess}}<td class="num">{{money cessAmount}}</td>{{/if}}
        <td class="num">{{money lineTotal}}</td>
      </tr>
      {{/each}}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="6" class="num">Totals</td>
        <td class="num">{{money totals.taxableValue}}</td>
        {{#if isIntraState}}
          <td class="num">{{money totals.cgst}}</td>
          <td class="num">{{money totals.sgst}}</td>
        {{else}}
          <td class="num">{{money totals.igst}}</td>
        {{/if}}
        {{#if hasCess}}<td class="num">{{money totals.cess}}</td>{{/if}}
        <td class="num">{{money totals.grandTotal}}</td>
      </tr>
    </tfoot>
  </table>

  {{!-- =========================== Summary =========================== --}}
  <section class="summary">
    <table>
      {{!-- Taxable value is ALREADY net of the §15(3)(a) discount, so the
            summary must not subtract the discount again (that double-counts).
            The discount is shown as an informational "You saved" note below the
            grand total instead. --}}
      <tr><td>Taxable value{{#if discount.amount}} (after discount){{/if}}</td><td>₹{{money totals.taxableValue}}</td></tr>
      {{#if isIntraState}}
        <tr><td>CGST</td><td>₹{{money totals.cgst}}</td></tr>
        <tr><td>SGST</td><td>₹{{money totals.sgst}}</td></tr>
      {{else}}
        <tr><td>IGST</td><td>₹{{money totals.igst}}</td></tr>
      {{/if}}
      {{#if hasCess}}
        <tr><td>GST Compensation Cess</td><td>₹{{money totals.cess}}</td></tr>
      {{/if}}
      {{#if totals.shipping}}
        <tr class="muted"><td>Incl. shipping &amp; handling (with GST)</td><td>₹{{money totals.shipping}}</td></tr>
      {{else}}
        <tr class="muted"><td>Shipping</td><td>Free</td></tr>
      {{/if}}
      <tr class="grand-total"><td>Grand Total</td><td>₹{{money totals.grandTotal}}</td></tr>
      {{#if discount.amount}}
        <tr class="muted"><td>You saved{{#if discount.couponCode}} ({{discount.couponCode}}){{/if}}</td>
            <td>− ₹{{money discount.amount}}</td></tr>
      {{/if}}
    </table>
  </section>

  {{#if amountInWords}}
  <p class="amount-in-words">
    <strong>Amount in words:</strong> {{amountInWords}}
  </p>
  {{/if}}

  {{!-- =========================== Declarations =========================== --}}
  <section class="declarations">
    <p><strong>Whether GST is payable on reverse charge:</strong> No</p>
    <p><em>This is a computer-generated invoice and does not require a physical signature.</em></p>
  </section>

  <footer class="invoice-footer">
    <p>Sold by {{seller.legalName}} via {{platform.name}}</p>
    {{#if grievance}}
    <p>Grievance Officer: {{grievance.name}} · {{grievance.email}}{{#if grievance.phone}} · {{grievance.phone}}{{/if}}</p>
    {{/if}}
  </footer>

</div>
</body>
</html>
`;

export const DEFAULT_TAX_INVOICE_CSS = `/*
 * Tax invoice print stylesheet.
 *
 * Optimised for A4 (210 × 297 mm) at the puppeteer-default 96 dpi.
 * Avoids modern features that headless Chromium handles inconsistently
 * (CSS Grid level 2, container queries) — flexbox + plain margins only.
 */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",
    Arial, sans-serif;
  font-size: 11px;
  line-height: 1.4;
  color: #1a1a1a;
  background: #fff;
}

.invoice {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px 24px;
}

/* ---------- Header ---------- */

.invoice-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid #1a1a1a;
  padding-bottom: 14px;
  margin-bottom: 18px;
}

.brand {
  flex: 1;
}

.brand .platform-name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.brand .platform-logo {
  max-height: 48px;
  max-width: 220px;
  object-fit: contain;
  display: block;
}

.brand .platform-tag {
  font-size: 10px;
  color: #666;
  margin-top: 2px;
}

.meta {
  text-align: right;
}

.meta h1 {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.meta-row {
  font-size: 11px;
}

.meta-row .label {
  color: #666;
  display: inline-block;
  min-width: 90px;
}

/* ---------- Parties (sold by / bill to / ship to) ---------- */

.parties {
  display: flex;
  gap: 16px;
  margin-bottom: 18px;
}

.party {
  flex: 1;
  padding: 10px 12px;
  background: #f7f7f7;
  border-radius: 4px;
  min-width: 0;
}

.party h3 {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #666;
  margin-bottom: 6px;
}

.party .store-logo {
  max-height: 36px;
  max-width: 140px;
  object-fit: contain;
  display: block;
  margin-bottom: 6px;
}

.party p {
  font-size: 11px;
}

.party .gstin {
  font-family: "SF Mono", Menlo, monospace;
  font-size: 10px;
  background: #fff;
  padding: 1px 5px;
  border-radius: 2px;
  display: inline-block;
  margin-top: 4px;
}

/* ---------- Items table ---------- */

table.items {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 14px;
  font-size: 10px;
}

table.items thead th {
  background: #1a1a1a;
  color: #fff;
  font-weight: 600;
  padding: 8px 6px;
  text-align: left;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

table.items thead th small {
  display: block;
  font-weight: 400;
  text-transform: none;
  font-size: 8px;
  opacity: 0.7;
  margin-top: 1px;
}

table.items tbody td {
  padding: 7px 6px;
  border-bottom: 1px solid #eee;
  vertical-align: top;
}

table.items tbody tr:last-child td {
  border-bottom: 2px solid #1a1a1a;
}

table.items td.num,
table.items th.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

table.items td .variant {
  display: block;
  color: #777;
  font-size: 9px;
  margin-top: 1px;
}

table.items tfoot td {
  padding: 8px 6px;
  font-weight: 700;
  font-size: 10px;
}

/* ---------- Totals summary block ---------- */

.summary {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 18px;
}

.summary table {
  border-collapse: collapse;
  min-width: 280px;
  font-size: 11px;
}

.summary td {
  padding: 4px 0;
}

.summary td:last-child {
  text-align: right;
  font-variant-numeric: tabular-nums;
  padding-left: 24px;
}

.summary tr.muted td {
  color: #777;
  font-size: 10px;
}

.summary tr.grand-total td {
  font-weight: 700;
  font-size: 13px;
  border-top: 2px solid #1a1a1a;
  padding-top: 8px;
}

.amount-in-words {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #ddd;
  font-size: 10px;
  font-style: italic;
  color: #444;
}

/* ---------- Declarations + footer ---------- */

.declarations {
  font-size: 10px;
  color: #444;
  margin-bottom: 14px;
}

.declarations p {
  margin-bottom: 3px;
}

footer.invoice-footer {
  border-top: 1px solid #ddd;
  padding-top: 10px;
  font-size: 9px;
  color: #888;
  text-align: center;
}

footer.invoice-footer p {
  margin-bottom: 2px;
}
`;

/** Documented context variables — drives the admin "insert variable" chips. */
export const TAX_INVOICE_VARIABLES = [
  'invoiceNumber',
  'invoiceDate',
  'platform.name',
  'platform.logoDataUri',
  'store.logoDataUri',
  'order.orderNumber',
  'order.buyerGstin',
  'placeOfSupply.name',
  'placeOfSupply.code',
  'seller.legalName',
  'seller.gstin',
  'seller.panNumber',
  'seller.stateName',
  'seller.stateCode',
  'billing.name',
  'billing.line1',
  'billing.city',
  'billing.state',
  'billing.postalCode',
  'shipping.name',
  'shipping.line1',
  'shipping.city',
  'shipping.state',
  'shipping.postalCode',
  'items',
  'totals.taxableValue',
  'totals.cgst',
  'totals.sgst',
  'totals.igst',
  'totals.cess',
  'totals.shipping',
  'totals.grandTotal',
  'isIntraState',
  'hasCess',
  'discount.amount',
  'discount.couponCode',
  'amountInWords',
  'grievance.name',
  'grievance.email',
  'grievance.phone',
];

/** Stable DB key for the canonical tax invoice template. */
export const TAX_INVOICE_TEMPLATE_KEY = 'tax_invoice';
