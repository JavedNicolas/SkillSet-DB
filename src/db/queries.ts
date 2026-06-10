import type { Db } from './database.js';
import type { DedupedSkill } from '../scan/dedupe.js';
import type { ExtractedRule } from '../extract/types.js';

export interface SkillRow {
  id: number;
  name: string;
  scope: string;
  path: string;
  dir_path: string;
  content_hash: string;
  description: string | null;
  shadowed_by: number | null;
  extraction_status: string;
  indexed_at: string | null;
}

export function getSkillByPath(db: Db, path: string): SkillRow | undefined {
  return db.prepare('SELECT * FROM skills WHERE path = ?').get(path) as SkillRow | undefined;
}

export function listSkills(db: Db): SkillRow[] {
  return db.prepare('SELECT * FROM skills ORDER BY scope, name').all() as SkillRow[];
}

/** Insert or update a skill row (without rules). Returns the skill id. */
export function upsertSkill(db: Db, skill: DedupedSkill, extractionStatus: string): number {
  const existing = getSkillByPath(db, skill.path);
  const frontmatterJson = JSON.stringify(skill.frontmatter);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE skills SET name=?, scope=?, dir_path=?, content_hash=?, description=?,
       frontmatter_json=?, extraction_status=?, indexed_at=? WHERE id=?`,
    ).run(
      skill.name, skill.scope, skill.dirPath, skill.contentHash, skill.description,
      frontmatterJson, extractionStatus, now, existing.id,
    );
    return existing.id;
  }
  const res = db.prepare(
    `INSERT INTO skills (name, scope, path, dir_path, content_hash, description,
     frontmatter_json, extraction_status, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    skill.name, skill.scope, skill.path, skill.dirPath, skill.contentHash,
    skill.description, frontmatterJson, extractionStatus, now,
  );
  return Number(res.lastInsertRowid);
}

/** Replace all rules and file records of a skill. */
export function replaceSkillData(db: Db, skillId: number, skill: DedupedSkill, rules: ExtractedRule[]): void {
  db.prepare('DELETE FROM rules WHERE skill_id = ?').run(skillId);
  db.prepare('DELETE FROM files WHERE skill_id = ?').run(skillId);

  const insertRule = db.prepare(
    `INSERT INTO rules (skill_id, source_file, category, title, rule_text, detail, priority, triggers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rules) {
    insertRule.run(
      skillId, r.sourceFile, ensureCategory(db, r.category), r.title, r.ruleText,
      r.detail, clampPriority(r.priority), r.triggers.join(' '),
    );
  }

  const insertFile = db.prepare(
    `INSERT OR REPLACE INTO files (path, skill_id, content_hash, mtime_ms, size) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const f of skill.files) {
    insertFile.run(f.path, skillId, f.contentHash, f.mtimeMs, f.size);
  }
}

/** Recompute shadowed_by pointers after a full scan. */
export function updateShadowing(db: Db, skills: DedupedSkill[]): void {
  const idByPath = new Map<string, number>();
  for (const row of listSkills(db)) idByPath.set(row.path, row.id);
  const update = db.prepare('UPDATE skills SET shadowed_by = ? WHERE path = ?');
  for (const skill of skills) {
    const winnerId = skill.shadowedByPath ? idByPath.get(skill.shadowedByPath) ?? null : null;
    update.run(winnerId, skill.path);
  }
}

/** Delete skills whose main file no longer exists on disk. Returns deleted names. */
export function deleteMissingSkills(db: Db, presentPaths: Set<string>): string[] {
  const all = listSkills(db);
  const gone = all.filter((s) => !presentPaths.has(s.path));
  const del = db.prepare('DELETE FROM skills WHERE id = ?');
  for (const s of gone) del.run(s.id);
  return gone.map((s) => s.name);
}

export function ensureCategory(db: Db, slug: string): string {
  const row = db.prepare('SELECT slug FROM categories WHERE slug = ?').get(slug);
  if (row) return slug;
  return 'general';
}

export function addCategory(db: Db, slug: string, label: string, keywords: string[]): void {
  db.prepare('INSERT OR IGNORE INTO categories (slug, label, keywords, is_seed) VALUES (?, ?, ?, 0)')
    .run(slug, label, keywords.join(' '));
}

export function categoryCount(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;
}

function clampPriority(p: number): number {
  return Math.min(4, Math.max(1, Math.round(p) || 2));
}

export interface StatusCounts {
  skills: { scope: string; status: string; n: number }[];
  rules: number;
  categories: number;
  shadowed: number;
}

export function statusCounts(db: Db): StatusCounts {
  return {
    skills: db
      .prepare(
        `SELECT scope, extraction_status AS status, COUNT(*) AS n FROM skills GROUP BY scope, extraction_status ORDER BY scope`,
      )
      .all() as { scope: string; status: string; n: number }[],
    rules: (db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number }).n,
    categories: categoryCount(db),
    shadowed: (db.prepare('SELECT COUNT(*) AS n FROM skills WHERE shadowed_by IS NOT NULL').get() as { n: number }).n,
  };
}
