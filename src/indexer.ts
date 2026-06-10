import type { Db } from './db/database.js';
import {
  deleteMissingSkills,
  getSkillByPath,
  replaceSkillData,
  updateShadowing,
  upsertSkill,
} from './db/queries.js';
import { dedupeSkills, type DedupedSkill } from './scan/dedupe.js';
import { scanSkills } from './scan/scanner.js';
import { extractRules, type ExtractOptions } from './extract/extractor.js';

export interface IndexOptions extends ExtractOptions {
  /** Re-extract everything even when content hashes are unchanged. */
  force?: boolean;
  onProgress?: (message: string) => void;
}

export interface IndexSummary {
  scanned: number;
  extracted: number;
  skipped: number;
  removed: string[];
  rules: number;
}

/**
 * Scan all skill roots, extract rules for new/changed skills (content-hash
 * cached), and reconcile the database. Used by index, sync and watch.
 */
export async function runIndex(db: Db, projectRoot: string, options: IndexOptions = {}): Promise<IndexSummary> {
  const progress = options.onProgress ?? (() => {});
  const skills = dedupeSkills(scanSkills(projectRoot));
  progress(`Scanned ${skills.length} skills`);

  let extracted = 0;
  let skipped = 0;

  for (const skill of skills) {
    if (!options.force && isFresh(db, skill, options)) {
      skipped++;
      continue;
    }
    const result = await extractRules(skill, options);
    const insert = db.transaction(() => {
      const skillId = upsertSkill(db, skill, result.method);
      replaceSkillData(db, skillId, skill, result.rules);
    });
    insert();
    extracted++;
    progress(`Indexed ${skill.name} (${skill.scope}): ${result.rules.length} rules [${result.method}]`);
  }

  const reconcile = db.transaction(() => {
    updateShadowing(db, skills);
    return deleteMissingSkills(db, new Set(skills.map((s) => s.path)));
  });
  const removed = reconcile();

  const rules = (db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number }).n;
  return { scanned: skills.length, extracted, skipped, removed, rules };
}

/** A skill is fresh when its hash is unchanged and its extraction can't be upgraded. */
function isFresh(db: Db, skill: DedupedSkill, options: ExtractOptions): boolean {
  const existing = getSkillByPath(db, skill.path);
  if (!existing || existing.content_hash !== skill.contentHash) return false;
  if (existing.extraction_status === 'llm') return true;
  if (existing.extraction_status === 'heuristic' || existing.extraction_status === 'failed') {
    // upgradeable to LLM extraction when it's now available
    return options.noLlm === true || !options.llmExtract;
  }
  return false; // 'pending'
}
