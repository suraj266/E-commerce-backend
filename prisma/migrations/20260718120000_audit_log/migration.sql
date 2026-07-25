-- Phase 3 (P3-05): append-only security audit log.
-- Additive-only and safe to apply to existing data.

-- The audit table. A row is written best-effort by AuditService.record() as a
-- plain INSERT (WHO / WHAT / before+after snapshots / request context). It is
-- APPEND-ONLY: the trigger below rejects every UPDATE and DELETE so the trail
-- can never be tampered with or silently rewritten, even by a compromised app
-- process or an errant migration.
CREATE TABLE "AuditLog" (
    "id"          TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail"  TEXT,
    "action"      TEXT NOT NULL,
    "entityType"  TEXT NOT NULL,
    "entityId"    TEXT,
    "before"      JSONB,
    "after"       JSONB,
    "ip"          TEXT,
    "userAgent"   TEXT,
    "requestId"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Query paths: by entity (the audit-log viewer's "history of this row"), by
-- actor (everything a given admin did), and by time (the default reverse-chron
-- feed + date-range filter).
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- ---------------------------------------------------------------------------
-- Append-only enforcement (DB-level; Prisma cannot model triggers).
-- ---------------------------------------------------------------------------
-- A single trigger function reused by both the UPDATE and DELETE triggers. Any
-- attempt to mutate or remove an existing audit row aborts the statement with a
-- hard exception — the ONLY legal write to this table is INSERT. This is the
-- integrity guarantee the audit trail exists to provide, so it lives at the
-- database boundary rather than in application code that could be bypassed.
CREATE OR REPLACE FUNCTION "auditlog_reject_mutation"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AuditLog is append-only: % is not permitted on this table.', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "auditlog_no_update"
    BEFORE UPDATE ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION "auditlog_reject_mutation"();

CREATE TRIGGER "auditlog_no_delete"
    BEFORE DELETE ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION "auditlog_reject_mutation"();
