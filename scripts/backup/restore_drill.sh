#!/usr/bin/env bash
# Restore drill: pull the latest S3 dump, restore into a THROWAWAY database, run
# sanity counts, and report the restore duration (RTO evidence). Run monthly.
# An untested backup is not a backup.
#
# Env:
#   S3_BUCKET            (required) same bucket pg_backup.sh writes to
#   RESTORE_DATABASE_URL (required) an EMPTY throwaway Postgres to restore into
#   AWS_*                standard AWS creds/region
set -euo pipefail

: "${S3_BUCKET:?S3_BUCKET is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required (a throwaway DB)}"

echo "Finding latest backup in ${S3_BUCKET}..."
LATEST="$(aws s3 ls "${S3_BUCKET%/}/" | sort | tail -n1 | awk '{print $4}')"
[ -z "$LATEST" ] && { echo "ERROR: no backups found." >&2; exit 1; }
echo "Latest: $LATEST"

TMP="/tmp/${LATEST}"
aws s3 cp "${S3_BUCKET%/}/${LATEST}" "$TMP"
gunzip -f "$TMP"
DUMP="${TMP%.gz}"

echo "Restoring into throwaway DB..."
START="$(date +%s)"
pg_restore --no-owner --no-privileges --clean --if-exists -d "$RESTORE_DATABASE_URL" "$DUMP"
END="$(date +%s)"
echo "Restore took $((END - START))s (RTO evidence)."

echo "Sanity counts:"
for T in Order Payment SellerOrder Refund Payout; do
  N="$(psql "$RESTORE_DATABASE_URL" -tAc "SELECT count(*) FROM \"$T\"" 2>/dev/null || echo 'ERR')"
  echo "  $T: $N"
done

rm -f "$DUMP"
echo "Restore drill complete. Record the duration in docs/DR-RUNBOOK.md."
