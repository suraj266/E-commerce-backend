-- Phase 2 money-out rails: value-integrity CHECK constraints.
-- Additive-only, defence-in-depth. Prisma cannot model CHECK constraints, so
-- these are hand-authored raw SQL (see the Phase-1 20260708000000 migration for
-- the canonical example). The application already enforces these invariants;
-- the CHECKs guarantee no code path can ever persist an invalid money row.

-- A refund must always move a strictly positive amount. A zero/negative refund
-- is meaningless and would corrupt the over-refund ceiling maths.
ALTER TABLE "Refund"
  ADD CONSTRAINT "refund_amount_positive"
  CHECK ("amount" > 0);

-- A payout can never disburse a negative net (refund adjustments net the gross
-- down, but never below zero — an over-refunded seller nets to exactly 0).
ALTER TABLE "Payout"
  ADD CONSTRAINT "payout_net_nonneg"
  CHECK ("netAmount" >= 0);

-- Each settled seller-order line contributes a non-negative amount.
ALTER TABLE "PayoutItem"
  ADD CONSTRAINT "payout_item_amount_nonneg"
  CHECK ("amount" >= 0);
