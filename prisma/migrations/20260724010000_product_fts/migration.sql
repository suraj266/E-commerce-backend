-- P4-B · Product full-text search (tsvector + GIN index).
--
-- Postgres FTS cannot be modeled by Prisma, so `Product.searchVector` is a
-- plain tsvector column maintained by a TRIGGER (declared in product.prisma as
-- `Unsupported("tsvector")?` so the client knows it exists; app code never
-- reads/writes it — the trigger recomputes it on INSERT/UPDATE).
--
-- WHY A TRIGGER, NOT A STORED GENERATED COLUMN: Postgres requires a generated
-- column's expression to be IMMUTABLE, and `to_tsvector('english', …)` is only
-- STABLE (the text-search config is resolved by name), so a generated column is
-- rejected with 42P17 "generation expression is not immutable". A trigger
-- function has no immutability constraint, so it is the standard FTS pattern.
--
-- Weighting: name (A) > shortDescription / seoKeywords (B) > description (C), so
-- a title hit outranks a body hit under ts_rank (see ProductService.searchProducts).
-- coalesce(...) guards a NULL text column from nullifying the whole vector via `||`.
-- Brand/tag/category text is added at QUERY time (a trigger over the Tag M:N
-- junction would be fragile) — searchProducts ORs brand-name relevance in.
--
-- PRODUCTION DEPLOY (userAction): the backfill UPDATE + GIN build lock writes on
-- "Product" for their duration. On a large/live catalog run in a low-traffic
-- window, or build the index out of band first with:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_searchVector_idx"
--     ON "Product" USING GIN ("searchVector");

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

CREATE OR REPLACE FUNCTION "product_search_vector_update"() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."shortDescription", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."seoKeywords", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."description", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "product_search_vector_trg" ON "Product";
CREATE TRIGGER "product_search_vector_trg"
  BEFORE INSERT OR UPDATE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION "product_search_vector_update"();

-- Backfill existing rows (fires the same expression the trigger uses).
UPDATE "Product" SET "searchVector" =
    setweight(to_tsvector('english', coalesce("name", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("shortDescription", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string("seoKeywords", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C');

CREATE INDEX IF NOT EXISTS "Product_searchVector_idx"
  ON "Product" USING GIN ("searchVector");
