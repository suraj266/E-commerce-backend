-- =============================================================================
-- InvoiceTemplate — admin-editable tax-invoice template
-- =============================================================================
-- Stores the Handlebars HTML body + CSS for the tax invoice in the DB (mirrors
-- EmailTemplate). The PDF generator renders from this row at request time
-- instead of reading a file from disk, which (a) fixes the prior ENOENT failure
-- where .hbs/.css assets weren't copied into dist/, and (b) lets admins design
-- the invoice template from the admin panel.
-- =============================================================================

-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id"          TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "htmlBody"    TEXT NOT NULL,
    "css"         TEXT NOT NULL,
    "variables"   TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isEnabled"   BOOLEAN NOT NULL DEFAULT true,
    "isSystem"    BOOLEAN NOT NULL DEFAULT true,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "InvoiceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTemplate_key_key" ON "InvoiceTemplate"("key");
