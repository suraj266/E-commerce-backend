-- P3-09 Guest cart: a cart is owned by EXACTLY ONE of a Customer or an
-- anonymous guest session. Additive + backfill-safe: existing customer carts
-- keep their customerId and get sessionToken = NULL, satisfying the new CHECK.

-- 1. customerId becomes nullable (guest carts have no customer).
ALTER TABLE "Cart" ALTER COLUMN "customerId" DROP NOT NULL;

-- 2. Opaque guest-session token (httpOnly cookie). NULL for customer carts.
ALTER TABLE "Cart" ADD COLUMN "sessionToken" TEXT;

-- 3. Replace the implicit full unique on customerId (from the old `@unique`)
--    with a PARTIAL unique so multiple guest carts (customerId IS NULL) are
--    allowed while still capping a customer at one cart.
DROP INDEX "Cart_customerId_key";
CREATE UNIQUE INDEX "Cart_customerId_key" ON "Cart" ("customerId") WHERE "customerId" IS NOT NULL;

-- 4. One cart per guest session; NULLs (customer carts) excluded.
CREATE UNIQUE INDEX "Cart_sessionToken_key" ON "Cart" ("sessionToken") WHERE "sessionToken" IS NOT NULL;

-- 5. Exactly-one-owner invariant: customer XOR guest session. `<>` on the two
--    IS NULL booleans is a logical XOR — rejects both-null and both-set rows.
--    (Prisma does not model CHECK constraints — intentionally raw SQL.)
ALTER TABLE "Cart"
  ADD CONSTRAINT "cart_one_owner"
  CHECK (("customerId" IS NULL) <> ("sessionToken" IS NULL));
