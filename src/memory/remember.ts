import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/database.js';
import { getMeta, replaceSkillData, setSkillActivation, upsertSkill } from '../db/queries.js';
import { extractRules } from '../extract/extractor.js';
import { bestCategory, keywords } from '../extract/heuristic.js';
import { scanSkillDir } from '../scan/scanner.js';
import { homeDir } from '../paths.js';
import type { SkillScope } from '../paths.js';

export interface RememberInput {
  ruleText: string;
  /** Framework/language bucket: flutter, react, typescript, ... Default: detected from the project stack. */
  tech?: string;
  category?: string;
  /** 1 critical .. 4 info. Default 2. */
  priority?: number;
  triggers?: string[];
  detail?: string;
}

export interface RememberResult {
  skillName: string;
  skillDir: string;
  referencePath: string;
  tech: string;
  scope: 'project' | 'global';
}

const IMPACT_BY_PRIORITY: Record<number, string> = { 1: 'CRITICAL', 2: 'HIGH', 3: 'MEDIUM', 4: 'LOW' };

/** Frameworks first (most specific), then languages. */
const TECH_PREFERENCE = [
  'flutter', 'react-native', 'nextjs', 'react', 'vue', 'nuxt', 'svelte', 'angular',
  'nestjs', 'express', 'fastify', 'django', 'flask', 'fastapi', 'rails', 'laravel',
  'supabase', 'firebase', 'electron',
  'dart', 'typescript', 'javascript', 'python', 'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'csharp',
];

/**
 * Persist a conversation rule as a generated skill on disk AND index it
 * immediately. The file is the source of truth: it survives SkillsDB being
 * removed (it is a normal skill Claude can load natively) and propagates to
 * other projects through their own indexing.
 */
export async function rememberRule(
  db: Db,
  projectRoot: string,
  scope: 'project' | 'global',
  input: RememberInput,
): Promise<RememberResult> {
  const ruleText = input.ruleText.trim().replace(/\s+/g, ' ').slice(0, 300);
  if (!ruleText) throw new Error('Rule text is empty.');

  const tech = normalizeTech(input.tech) ?? techFromStack(db) ?? 'general';
  const skillName = `skillsdb-memory-${tech}`;
  const skillDir =
    scope === 'project'
      ? path.join(projectRoot, '.claude', 'skills', skillName)
      : path.join(homeDir(), '.claude', 'skills', skillName);
  const refDir = path.join(skillDir, 'references');
  fs.mkdirSync(refDir, { recursive: true });

  const category = input.category?.trim() || bestCategory(`${tech} ${ruleText}`, 'general');
  const priority = clampPriority(input.priority ?? 2);
  const triggers = uniq([
    ...(input.triggers ?? []).map((t) => t.toLowerCase().trim()),
    ...keywords(ruleText).slice(0, 8),
    tech !== 'general' ? tech : '',
  ]);

  const referencePath = path.join(refDir, uniqueSlug(refDir, ruleText) + '.md');
  fs.writeFileSync(
    referencePath,
    [
      '---',
      `title: ${yamlEscape(ruleText)}`,
      `impact: ${IMPACT_BY_PRIORITY[priority]}`,
      `tags: ${triggers.join(' ')}`,
      `category: ${category}`,
      `remembered: ${new Date().toISOString()}`,
      '---',
      '',
      input.detail?.trim() ?? '',
      '',
    ].join('\n'),
  );

  regenerateSkillMd(skillDir, skillName, tech);
  await indexMemorySkill(db, skillDir, scope === 'project' ? 'project' : 'user');

  return { skillName, skillDir, referencePath, tech, scope };
}

/** Remove a remembered rule by its rule id. Returns false when the rule is not a memory rule. */
export async function forgetRule(db: Db, ruleId: number): Promise<boolean> {
  const row = db
    .prepare(
      `SELECT r.source_file, s.name, s.dir_path, s.scope FROM rules r
       JOIN skills s ON s.id = r.skill_id WHERE r.id = ?`,
    )
    .get(ruleId) as { source_file: string; name: string; dir_path: string; scope: string } | undefined;
  if (!row || !row.name.startsWith('skillsdb-memory-')) return false;
  if (!row.source_file.includes(`references${path.sep}`)) return false;

  fs.rmSync(row.source_file, { force: true });
  const remaining = fs
    .readdirSync(path.join(row.dir_path, 'references'))
    .filter((f) => f.endsWith('.md'));

  if (remaining.length === 0) {
    fs.rmSync(row.dir_path, { recursive: true, force: true });
    db.prepare('DELETE FROM skills WHERE dir_path = ? AND scope = ?').run(row.dir_path, row.scope);
    return true;
  }
  const tech = row.name.replace('skillsdb-memory-', '');
  regenerateSkillMd(row.dir_path, row.name, tech);
  await indexMemorySkill(db, row.dir_path, row.scope as SkillScope);
  return true;
}

/**
 * Rebuild SKILL.md from the reference files. The body mirrors every rule as
 * a bullet so Claude's native skill loading works without SkillsDB — the
 * extractor skips this body (metadata.generator) to avoid duplicates.
 */
function regenerateSkillMd(skillDir: string, skillName: string, tech: string): void {
  const refDir = path.join(skillDir, 'references');
  const rules: { title: string; impact: string }[] = [];
  for (const file of fs.readdirSync(refDir).filter((f) => f.endsWith('.md')).sort()) {
    const content = fs.readFileSync(path.join(refDir, file), 'utf8');
    const title = content.match(/^title:\s*(.+)$/m)?.[1]?.replace(/^"|"$/g, '') ?? '';
    const impact = content.match(/^impact:\s*(.+)$/m)?.[1] ?? 'MEDIUM';
    if (title) rules.push({ title, impact });
  }

  const techLabel = tech === 'general' ? 'any project' : `${tech} projects`;
  const description =
    tech === 'general'
      ? 'Rules the user stated in conversation, remembered by SkillsDB. Apply them in every project.'
      : `Rules the user stated in conversation for ${tech}, remembered by SkillsDB. Use when working with ${tech} code.`;

  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${skillName}`,
      `description: ${yamlEscape(description)}`,
      'metadata:',
      '  generator: skillsdb',
      '---',
      '',
      `# Remembered rules (${techLabel})`,
      '',
      'Stated by the user in conversation and captured with `skillsdb remember` / the skillsdb_remember MCP tool.',
      'Full metadata lives in `references/`. Follow every rule below:',
      '',
      ...rules.map((r) => `- [${r.impact}] ${r.title}`),
      '',
    ].join('\n'),
  );
}

/** Index exactly this skill directory — no global sync, no LLM, no activation churn. */
async function indexMemorySkill(db: Db, skillDir: string, scope: SkillScope): Promise<void> {
  const scanned = scanSkillDir(skillDir, scope);
  if (!scanned) return;
  const deduped = { ...scanned, shadowedByPath: null };
  const result = await extractRules(deduped, { noLlm: true });
  const write = db.transaction(() => {
    const skillId = upsertSkill(db, deduped, 'llm');
    replaceSkillData(db, skillId, deduped, result.rules);
    // the user just stated this rule in this project: definitionally relevant here
    setSkillActivation(db, skillId, true, null);
  });
  write();
}

export function techFromStack(db: Db): string | null {
  try {
    const raw = getMeta(db, 'stack_profile');
    if (!raw) return null;
    const profile = JSON.parse(raw) as { languages: string[]; frameworks: string[] };
    const tags = new Set([...profile.frameworks, ...profile.languages]);
    return TECH_PREFERENCE.find((t) => tags.has(t)) ?? null;
  } catch {
    return null;
  }
}

function normalizeTech(tech: string | undefined): string | null {
  if (!tech) return null;
  const slug = tech.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || null;
}

function uniqueSlug(refDir: string, ruleText: string): string {
  const base =
    ruleText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 6)
      .join('-') || 'rule';
  let slug = base;
  for (let i = 2; fs.existsSync(path.join(refDir, `${slug}.md`)); i++) slug = `${base}-${i}`;
  return slug;
}

function yamlEscape(text: string): string {
  return /[:#[\]{}'"|>&*!?%@`]/.test(text) ? JSON.stringify(text) : text;
}

function clampPriority(p: number): number {
  return Math.min(4, Math.max(1, Math.round(p) || 2));
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}
