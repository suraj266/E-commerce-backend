#!/usr/bin/env bash
# Logical backup: pg_dump (custom format) -> gzip -> S3 (SSE) -> prune old.
# Run from a context that has `pg_dump` (postgres-client) + `aws` CLI, e.g. a
# postgres:15-based backup sidecar or the deploy pipeline. Schedule daily.
#
# Env:
#   DATABASE_URL        (required) postgres connection string
#   S3_BUCKET           (required) e.g. s3://my-backups/ecommerce
#   RETENTION_DAYS      (optional, default 14) prune S3 objects older than this
#   AWS_*               standard AWS credentials/region for the `aws` CLI
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${S3_BUCKET:?S3_BUCKET is required (e.g. s3://bucket/prefix)}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
FILE="ecommerce-${TS}.dump.gz"
TMP="/tmp/${FILE}"

echo "[$(date -u +%FT%TZ)] Dumping database..."
# -Fc custom format (compressed, selective restore); strip ownership/privileges
# so it restores cleanly into a fresh instance.
pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$TMP"

SIZE="$(wc -c < "$TMP")"
if [ "$SIZE" -lt 1024 ]; then
  echo "ERROR: dump is suspiciously small (${SIZE} bytes) — aborting, not uploading." >&2
  rm -f "$TMP"
  exit 1
fi

echo "[$(date -u +%FT%TZ)] Uploading ${FILE} (${SIZE} bytes) to ${S3_BUCKET}..."
aws s3 cp "$TMP" "${S3_BUCKET%/}/${FILE}" --sse AES256
rm -f "$TMP"

# Prune objects older than RETENTION_DAYS (best-effort; S3 lifecycle policy is
# the durable enforcement — this is a convenience).
echo "Pruning backups older than ${RETENTION_DAYS} days..."
CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -u -v-"${RETENTION_DAYS}"d +%Y-%m-%d)"
aws s3 ls "${S3_BUCKET%/}/" | while read -r line; do
  d="$(echo "$line" | awk '{print $1}')"
  f="$(echo "$line" | awk '{print $4}')"
  [ -z "$f" ] && continue
  if [[ "$d" < "$CUTOFF" ]]; then
    echo "  pruning $f"
    aws s3 rm "${S3_BUCKET%/}/${f}"
  fi
done

echo "[$(date -u +%FT%TZ)] Backup complete: ${FILE}"
