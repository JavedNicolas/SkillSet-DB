import { openProjectDb } from '../db/database.js';
import { findProjectRoot, projectDbPath } from '../paths.js';

export interface ListOptions {
  categories?: boolean;
  category?: string;
  rules?: boolean;
}

export function listCommand(cwd: string, options: ListOptions): void {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }
  const db = openProjectDb(projectDbPath(projectRoot), { readonly: true });
  try {
    if (options.categories) {
      const rows = db
        .prepare(
          `SELECT c.slug, c.label, c.is_seed, COUNT(r.id) AS n
           FROM categories c LEFT JOIN rules r ON r.category = c.slug
           GROUP BY c.slug ORDER BY n DESC, c.slug`,
        )
        .all() as { slug: string; label: string; is_seed: number; n: number }[];
      for (const row of rows) {
        console.log(`${String(row.n).padStart(4)}  ${row.slug}${row.is_seed ? '' : ' (custom)'}`);
      }
      return;
    }

    if (options.rules || options.category) {
      const where = options.category
        ? 'WHERE r.category = ? AND s.shadowed_by IS NULL AND s.active = 1'
        : 'WHERE s.shadowed_by IS NULL AND s.active = 1';
      const args = options.category ? [options.category] : [];
      const rows = db
        .prepare(
          `SELECT r.id, r.category, r.priority, r.rule_text, s.name AS skill
           FROM rules r JOIN skills s ON s.id = r.skill_id
           ${where} ORDER BY r.category, r.priority, r.id`,
        )
        .all(...args) as { id: number; category: string; priority: number; rule_text: string; skill: string }[];
      let lastCategory = '';
      for (const row of rows) {
        if (row.category !== lastCategory) {
          console.log(`\n## ${row.category}`);
          lastCategory = row.category;
        }
        console.log(`  R${row.id} P${row.priority} ${row.rule_text} (${row.skill})`);
      }
      console.log(`\n${rows.length} rules`);
      return;
    }

    const rows = db
      .prepare(
        `SELECT s.name, s.scope, s.extraction_status, s.shadowed_by, s.active, s.inactive_reason, COUNT(r.id) AS n
         FROM skills s LEFT JOIN rules r ON r.skill_id = s.id
         GROUP BY s.id ORDER BY s.scope, s.name`,
      )
      .all() as {
      name: string;
      scope: string;
      extraction_status: string;
      shadowed_by: number | null;
      active: number;
      inactive_reason: string | null;
      n: number;
    }[];
    for (const row of rows) {
      const shadow = row.shadowed_by ? ' (shadowed)' : '';
      const inactive = !row.active ? ` (inactive: ${row.inactive_reason ?? 'deactivated'})` : '';
      console.log(
        `${row.scope.padEnd(8)} ${String(row.n).padStart(4)} rules  [${row.extraction_status}] ${row.name}${shadow}${inactive}`,
      );
    }
    console.log(`\n${rows.length} skills`);
  } finally {
    db.close();
  }
}
