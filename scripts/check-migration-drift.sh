#!/usr/bin/env bash
# Fails (exit 1) if prisma/schema/*.prisma has changes not represented by a
# committed migration. Wire into CI (backend workflow) after `prisma generate`.
#
# Requires a throwaway shadow database: set SHADOW_DATABASE_URL to an empty
# Postgres CI can reach (a service container).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${SHADOW_DATABASE_URL:-}" ]; then
  echo "ERROR: SHADOW_DATABASE_URL is not set (need an empty Postgres for the diff)." >&2
  exit 2
fi

echo "Checking migration drift (schema vs. committed migrations)..."
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code

# exit-code semantics: 0 = in sync, 2 = drift detected, 1 = error.
# `set -e` turns a non-zero exit into a failed CI step.
echo "No drift: schema and migrations are in sync."
