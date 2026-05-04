/**
 * =============================================================================
 * Categories seeder
 * =============================================================================
 *
 * Parses `backend/docs/categories.md` (source of truth — see that file for
 * the full tree) and upserts the hierarchy into the Category table.
 *
 * Idempotent: re-running won't duplicate, won't overwrite admin edits to
 * name/imageUrl/iconUrl. Only fills in fields that haven't been set yet.
 * Soft-deleted categories are revived if they reappear in the MD.
 *
 * Markdown contract:
 *   # 1. Department         → L1 (parentId = null)
 *   ## 1.1 Sub-department   → L2 (parentId = L1)
 *   - Leaf                   → L3 (parentId = L2)
 *     - Sub-leaf             → L4 (parentId = L3, used sparingly)
 *
 * Lines that don't match these patterns are ignored, so prose, tables, and
 * the summary section in categories.md don't pollute the seed.
 *
 * Run:
 *   pnpm seed:categories      # (build first if running compiled)
 *   pnpm seed:categories:dev  # ts-node, no build needed
 *
 * Inside Docker:
 *   docker exec ecommerce_backend_dev pnpm seed:categories:dev
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

interface ParsedNode {
  level: 1 | 2 | 3 | 4;
  name: string;
  /** Path of ancestor names — used to derive a unique slug & set parent. */
  ancestors: string[];
  displayOrder: number;
}

/**
 * Parse the categories.md file into a flat list of nodes with `level` and
 * `ancestors`. Ancestors let us look up the parent's slug after we've slugged
 * the whole tree, and they make slugs unique across departments
 * (e.g. "Mobile Cases" appears under multiple sub-departments).
 */
function parseMarkdown(md: string): ParsedNode[] {
  const lines = md.split(/\r?\n/);
  const nodes: ParsedNode[] = [];

  // Stack indexed by level — `stack[level]` = current name at that level.
  const stack: { [level: number]: string } = {};

  // Per-level monotonic counter so display order matches MD order.
  const counters = { 1: 0, 2: 0, 3: 0, 4: 0 };

  // Hard stop when we hit any non-numbered `#` heading after the tree
  // (e.g. `# Summary`, `# Conventions`). Stops phantom L3 attachment to
  // whatever the last category was.
  let inTree = false;

  for (const raw of lines) {
    const line = raw.replace(/\r/g, '');

    // Any numberless `# ` heading after we've started parsing the tree
    // means we're past the last department — stop.
    if (inTree && /^# (?!\d+\.)/.test(line)) {
      break;
    }

    // L1: "# 1. Department"  — strict numeric prefix to avoid matching
    // the title `# Marketplace Category Tree`
    const l1 = line.match(/^# +\d+\.\s+(.+?)\s*$/);
    if (l1) {
      inTree = true;
      stack[1] = stripNotes(l1[1]);
      delete stack[2];
      delete stack[3];
      delete stack[4];
      counters[1] += 1;
      counters[2] = 0;
      counters[3] = 0;
      counters[4] = 0;
      nodes.push({
        level: 1,
        name: stack[1],
        ancestors: [],
        displayOrder: counters[1],
      });
      continue;
    }

    // L2: "## 1.1 Sub-department"  — also requires numeric prefix
    const l2 = line.match(/^## +\d+\.\d+\s+(.+?)\s*$/);
    if (l2 && stack[1]) {
      stack[2] = stripNotes(l2[1]);
      delete stack[3];
      delete stack[4];
      counters[2] += 1;
      counters[3] = 0;
      counters[4] = 0;
      nodes.push({
        level: 2,
        name: stack[2],
        ancestors: [stack[1]],
        displayOrder: counters[2],
      });
      continue;
    }

    // L3: "- Leaf" (zero indent)
    const l3 = line.match(/^- +(.+?)\s*$/);
    if (l3 && stack[1] && stack[2]) {
      stack[3] = stripNotes(l3[1]);
      delete stack[4];
      counters[3] += 1;
      counters[4] = 0;
      nodes.push({
        level: 3,
        name: stack[3],
        ancestors: [stack[1], stack[2]],
        displayOrder: counters[3],
      });
      continue;
    }

    // L4: "  - Sub-leaf" (2-space indent)
    const l4 = line.match(/^ {2}- +(.+?)\s*$/);
    if (l4 && stack[1] && stack[2] && stack[3]) {
      stack[4] = stripNotes(l4[1]);
      counters[4] += 1;
      nodes.push({
        level: 4,
        name: stack[4],
        ancestors: [stack[1], stack[2], stack[3]],
        displayOrder: counters[4],
      });
      continue;
    }
  }

  return nodes;
}

/**
 * Strip parenthetical notes that the MD uses for inline sub-typing.
 * e.g. "Headphones (Studio / Lavalier / USB)" → "Headphones"
 *      "Milk (Cow / Buffalo / Toned / Full Cream)" → "Milk"
 *
 * Bold/italic markers are also stripped if any.
 */
function stripNotes(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/⭐/g, '')
    .replace(/\s*\(.+?\)\s*$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a globally-unique slug. Uses just the name first; falls back to
 * `parent-slug__name-slug` if the bare name collides with a sibling tree.
 *
 * The collision is rare in our tree (e.g. "Cricket" is only an L2 once;
 * "Helmets" appears in both Bicycles and Two-Wheelers — disambiguate those).
 */
function buildSlug(
  node: ParsedNode,
  takenSlugs: Set<string>,
): string {
  const base = slugify(node.name);
  if (!takenSlugs.has(base)) {
    takenSlugs.add(base);
    return base;
  }
  // Disambiguate using the immediate parent
  const parentName = node.ancestors[node.ancestors.length - 1];
  const disambiguated = `${slugify(parentName)}-${base}`;
  if (!takenSlugs.has(disambiguated)) {
    takenSlugs.add(disambiguated);
    return disambiguated;
  }
  // Last resort — root department prefix
  const rootName = node.ancestors[0] ?? node.name;
  const fully = `${slugify(rootName)}-${disambiguated}`;
  takenSlugs.add(fully);
  return fully;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

interface SeedNode extends ParsedNode {
  slug: string;
  parentSlug: string | null;
}

async function main() {
  // Resolve the MD relative to the backend root. This source file lives at
  // backend/src/prisma/seed/, so backend/docs/categories.md is three levels up.
  // When compiled it lives at backend/dist/prisma/seed/, same depth — works
  // for both ts-node and compiled runs.
  const mdPath = resolve(__dirname, '..', '..', '..', 'docs', 'categories.md');
  const md = readFileSync(mdPath, 'utf-8');

  const parsed = parseMarkdown(md);
  console.log(
    `[categories.seed] Parsed ${parsed.length} nodes from ${mdPath}`,
  );
  console.log(
    `  L1: ${parsed.filter((n) => n.level === 1).length}` +
      ` · L2: ${parsed.filter((n) => n.level === 2).length}` +
      ` · L3: ${parsed.filter((n) => n.level === 3).length}` +
      ` · L4: ${parsed.filter((n) => n.level === 4).length}`,
  );

  // Slug everything, with a per-ancestor map so siblings share the same
  // slug-namespace and parent lookup is O(1).
  const taken = new Set<string>();
  const slugByPath = new Map<string, string>();
  const seeds: SeedNode[] = [];

  for (const node of parsed) {
    const slug = buildSlug(node, taken);
    const path = [...node.ancestors, node.name].join(' / ');
    slugByPath.set(path, slug);

    const parentPath = node.ancestors.join(' / ');
    const parentSlug =
      node.ancestors.length === 0 ? null : slugByPath.get(parentPath) ?? null;

    seeds.push({ ...node, slug, parentSlug });
  }

  // Upsert level-by-level so a parent always exists before its children.
  // Within a level, order doesn't matter.
  let created = 0;
  let updated = 0;
  let revived = 0;

  for (const level of [1, 2, 3, 4] as const) {
    const slice = seeds.filter((n) => n.level === level);
    for (const node of slice) {
      // Resolve parent's UUID from its slug
      let parentId: string | null = null;
      if (node.parentSlug) {
        const parent = await prisma.category.findUnique({
          where: { slug: node.parentSlug },
        });
        if (!parent) {
          console.warn(
            `[categories.seed] Skipping "${node.name}" — parent ` +
              `"${node.parentSlug}" not found.`,
          );
          continue;
        }
        parentId = parent.id;
      }

      const existing = await prisma.category.findUnique({
        where: { slug: node.slug },
      });

      if (!existing) {
        await prisma.category.create({
          data: {
            name: node.name,
            slug: node.slug,
            parentId,
            displayOrder: node.displayOrder,
            isActive: true,
          },
        });
        created += 1;
      } else {
        // Idempotent update: only touch parentId / displayOrder.
        // Preserve admin edits to name, description, imageUrl, iconUrl.
        const dataToUpdate: {
          parentId?: string | null;
          displayOrder?: number;
          deletedAt?: Date | null;
          isActive?: boolean;
        } = {};
        if (existing.parentId !== parentId) dataToUpdate.parentId = parentId;
        if (existing.displayOrder !== node.displayOrder) {
          dataToUpdate.displayOrder = node.displayOrder;
        }
        if (existing.deletedAt !== null) {
          dataToUpdate.deletedAt = null;
          dataToUpdate.isActive = true;
          revived += 1;
        }
        if (Object.keys(dataToUpdate).length > 0) {
          await prisma.category.update({
            where: { id: existing.id },
            data: dataToUpdate,
          });
          updated += 1;
        }
      }
    }
  }

  console.log(
    `[categories.seed] Done. ` +
      `created=${created} updated=${updated} revived=${revived}`,
  );
}

main()
  .catch((e) => {
    console.error('[categories.seed] FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
