-- Make the default admin-panel accent brand indigo (matches the storefront
-- --brand) instead of the original mono near-black. Only updates the singleton
-- row if it is STILL the original mono default, so any custom color an admin
-- has already chosen is preserved. Idempotent: re-running is a no-op once the
-- row is indigo (or has been customized).
UPDATE "AdminThemeSetting"
SET "primaryLight" = 'oklch(0.42 0.16 264)',
    "primaryDark"  = 'oklch(0.62 0.18 264)',
    "updatedAt"    = NOW()
WHERE "id" = 'global'
  AND "primaryLight" = 'oklch(0.205 0 0)'
  AND "primaryDark"  = 'oklch(0.922 0 0)';
