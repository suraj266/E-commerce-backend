-- Product compliance: HSN code (Harmonized System of Nomenclature)
-- Indian GST requirement for tax invoicing. Nullable for now so existing
-- products don't fail validation; sellers fill it in via the product form.

ALTER TABLE "Product" ADD COLUMN "hsnCode" TEXT;
