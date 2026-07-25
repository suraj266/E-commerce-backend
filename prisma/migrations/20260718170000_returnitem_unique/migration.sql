-- Phase 3 Wave-3 review fix #1 (defense in depth): one ReturnItem per
-- (returnRequestId, orderItemId). The application already aggregates duplicate
-- request lines per order-item before insert, but this makes duplicate return
-- lines impossible at the DB level too, so no code path (present or future) can
-- write two rows for the same order-item in one return and multiply the refund.
CREATE UNIQUE INDEX IF NOT EXISTS "ReturnItem_returnRequestId_orderItemId_key"
    ON "ReturnItem" ("returnRequestId", "orderItemId");
