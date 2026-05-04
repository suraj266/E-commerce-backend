-- CreateTable
CREATE TABLE "AdminThemeSetting" (
    "id" TEXT NOT NULL,
    "primaryLight" TEXT NOT NULL,
    "primaryDark" TEXT NOT NULL,
    "accentLight" TEXT NOT NULL,
    "accentDark" TEXT NOT NULL,
    "sidebarLight" TEXT NOT NULL,
    "sidebarDark" TEXT NOT NULL,
    "destructiveLight" TEXT NOT NULL,
    "destructiveDark" TEXT NOT NULL,
    "radius" TEXT NOT NULL,
    "fontFamily" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "AdminThemeSetting_pkey" PRIMARY KEY ("id")
);

-- Seed singleton row with current globals.css defaults.
INSERT INTO "AdminThemeSetting" (
    "id",
    "primaryLight", "primaryDark",
    "accentLight",  "accentDark",
    "sidebarLight", "sidebarDark",
    "destructiveLight", "destructiveDark",
    "radius", "fontFamily", "updatedAt"
) VALUES (
    'global',
    'oklch(0.205 0 0)', 'oklch(0.922 0 0)',
    'oklch(0.97 0 0)',  'oklch(0.269 0 0)',
    'oklch(0.985 0 0)', 'oklch(0.205 0 0)',
    'oklch(0.577 0.245 27.325)', 'oklch(0.704 0.191 22.216)',
    '0.625rem', 'inter', NOW()
)
ON CONFLICT ("id") DO NOTHING;
