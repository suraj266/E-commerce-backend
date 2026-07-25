-- Phase 3 adversarial-review fixes #4 (AuditLog) and #5 (ConsentRecord).
--
-- The append-only guarantees on "AuditLog" and "ConsentRecord" were enforced
-- with ROW-LEVEL BEFORE UPDATE/DELETE triggers only. PostgreSQL does NOT fire
-- row-level triggers on TRUNCATE (only STATEMENT-level ON TRUNCATE triggers
-- fire), so `TRUNCATE TABLE "AuditLog"` / `"ConsentRecord"` silently bypassed
-- the immutability guard and could wipe the entire trail with no error.
--
-- Close the hole by adding statement-level BEFORE TRUNCATE triggers that reuse
-- the existing reject functions. Those functions only read TG_OP (no OLD/NEW),
-- so they RAISE correctly when invoked with TG_OP = 'TRUNCATE'.
--
-- Note: this makes the guard complete against the table OWNER's default
-- TRUNCATE privilege. For defense against a fully compromised app process, also
-- run the runtime under a NON-owner role granted only INSERT (+ SELECT) and
-- REVOKE UPDATE/DELETE/TRUNCATE (see docs/SECRETS-ROTATION / DR runbook) — a
-- role that owns the table can still DROP/DISABLE triggers.

CREATE TRIGGER "auditlog_no_truncate"
    BEFORE TRUNCATE ON "AuditLog"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "auditlog_reject_mutation"();

CREATE TRIGGER "consent_record_no_truncate"
    BEFORE TRUNCATE ON "ConsentRecord"
    FOR EACH STATEMENT
    EXECUTE FUNCTION "consent_record_append_only"();
