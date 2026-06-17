/**
 * Single source of truth for the storefront "price including tax" value.
 *
 * Pricing model: the stored Product/Variant `price` is the BASE (pre-tax)
 * amount. `computePriceWithTax` always adds GST on top (base + base*rate/100),
 * and `computeTaxAmount` returns just the tax portion. The `show_price_with_tax`
 * SiteSetting only decides which of the two the storefront DISPLAYS — checkout
 * always charges base + tax regardless of the toggle.
 *
 * Used by product.service + cart.service so the two can never drift apart.
 *
 * Note: `Product.isPriceTaxInclusive` is no longer a pricing lever (kept in the
 * DB for historical order re-derivation only); it is intentionally not read here.
 */
export function computePriceWithTax(
  price: number | null | undefined,
  taxRate: number | null | undefined,
): number | null {
  if (price == null) return null;
  // No tax assigned → nothing to add; the storefront falls back to the base price.
  if (taxRate == null) return null;
  return Math.round((price + (price * taxRate) / 100) * 100) / 100;
}

/**
 * The tax portion alone (base × rate). Derived directly from the rate — NOT as
 * `priceWithTax - price` — so the 2dp rounding is exact and the two figures can
 * never drift by a paisa. Null when price or tax rate is missing.
 */
export function computeTaxAmount(
  price: number | null | undefined,
  taxRate: number | null | undefined,
): number | null {
  if (price == null || taxRate == null) return null;
  return Math.round(((price * taxRate) / 100) * 100) / 100;
}
