import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';
import type { Db } from '../db/database.js';
import { getMeta, setMeta } from '../db/queries.js';
import type { SkillsetDbConfig } from '../config.js';
import { callClaudeJson, findClaudeBin } from '../extract/claudeCli.js';
import { bestCategory, keywords } from '../extract/heuristic.js';
import { homeDir } from '../paths.js';
import { rememberRule } from './remember.js';

export interface ImportSummary {
  scanned: number;
  imported: number;
  skipped: number;
  method: 'llm' | 'fallback' | 'none';
}

const META_KEY = 'memory_import_hashes';
/** Memory types that can carry durable rules; 'reference' entries are links. */
const RULE_TYPES = new Set(['feedback', 'project', 'user']);

const MemoryImportSchema = z.object({
  rules: z
    .array(
      z.object({
        rule_text: z.string().min(5).max(300),
        tech: z.string().nullish(),
        category: z.string().nullish(),
        priority: z.coerce.number().int().min(1).max(4).default(2),
        triggers: z.array(z.string()).min(1).max(15),
        detail: z.string().max(2000).nullish(),
      }),
    )
    .max(40),
});

const IMPORT_SYSTEM_PROMPT = `You convert an AI coding assistant's memory notes (facts remembered about a user and project) into durable, injectable rules.

Output ONLY a JSON object, no prose, no fences:
{"rules": [{"rule_text": "...", "tech": "flutter|react|typescript|...|null", "category": "...", "priority": 1-4, "triggers": ["k1","k2",...], "detail": "..."}]}

Guidelines:
- Extract ONLY lasting, actionable instructions the user would want applied to future work ("commit often in working units", "never sign commits", "always use X"). Skip biography, links, one-off context, and anything purely descriptive.
- rule_text: ONE imperative sentence, max 160 chars, self-contained.
- tech: the framework/language the rule is specific to, or null when it applies regardless of stack.
- priority: 1 critical, 2 strong convention, 3 recommendation, 4 info.
- triggers: 3-12 lowercase keywords a task description would contain when the rule applies.
- A memory note may yield zero, one, or several rules. Return {"rules": []} when nothing qualifies.`;

/** The per-project memory directory Claude Code maintains. */
export function memoryDirForProject(projectRoot: string): string {
  const encoded = path.resolve(projectRoot).replace(/[/\\]/g, '-');
  return path.join(homeDir(), '.claude', 'projects', encoded, 'memory');
}

/**
 * Import rule-like entries from Claude's project memory into remembered
 * rules (project scope). Files are tracked by content hash so already
 * imported memories are never converted twice.
 */
export async function importMemoryRules(
  db: Db,
  projectRoot: string,
  config: SkillsetDbConfig,
  options: { noLlm?: boolean; onProgress?: (m: string) => void } = {},
): Promise<ImportSummary> {
  const progress = options.onProgress ?? (() => {});
  const memoryDir = memoryDirForProject(projectRoot);

  const files = listMemoryFiles(memoryDir);
  if (files.length === 0) return { scanned: 0, imported: 0, skipped: 0, method: 'none' };

  const imported = readImportedHashes(db);
  const fresh = files.filter((f) => !imported.has(f.hash));
  const skipped = files.length - fresh.length;
  if (fresh.length === 0) return { scanned: files.length, imported: 0, skipped, method: 'none' };

  progress(`Importing rules from ${fresh.length} Claude memory note(s)...`);

  let rules: z.infer<typeof MemoryImportSchema>['rules'] | null = null;
  let method: ImportSummary['method'] = 'fallback';
  const claudeBin = options.noLlm || config.noLlm ? null : findClaudeBin();
  if (claudeBin) {
    rules = await llmImport(claudeBin, config.extractionModel, fresh);
    if (rules) method = 'llm';
  }
  if (!rules) rules = fresh.map(fallbackRule).filter((r): r is NonNullable<typeof r> => r !== null);

  let count = 0;
  for (const rule of rules) {
    try {
      await rememberRule(db, projectRoot, 'project', {
        ruleText: rule.rule_text,
        tech: rule.tech ?? undefined,
        category: rule.category ?? undefined,
        priority: rule.priority,
        triggers: rule.triggers,
        detail: rule.detail ?? undefined,
      });
      count++;
      progress(`  Remembered: ${rule.rule_text}`);
    } catch {
      // one bad rule must not abort the import
    }
  }

  for (const f of fresh) imported.add(f.hash);
  setMeta(db, META_KEY, JSON.stringify([...imported]));

  return { scanned: files.length, imported: count, skipped, method };
}

interface MemoryFile {
  name: string;
  description: string;
  type: string;
  body: string;
  hash: string;
}

function listMemoryFiles(memoryDir: string): MemoryFile[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(memoryDir);
  } catch {
    return [];
  }
  const files: MemoryFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry === 'MEMORY.md') continue;
    try {
      const raw = fs.readFileSync(path.join(memoryDir, entry), 'utf8');
      const parsed = matter(raw);
      const metadata = (parsed.data?.metadata ?? {}) as Record<string, unknown>;
      const type = String(metadata.type ?? 'project');
      if (!RULE_TYPES.has(type)) continue;
      files.push({
        name: String(parsed.data?.name ?? entry.replace(/\.md$/, '')),
        description: String(parsed.data?.description ?? ''),
        type,
        body: parsed.content.trim(),
        hash: crypto.createHash('sha256').update(raw).digest('hex'),
      });
    } catch {
      // unreadable memory file: skip
    }
  }
  return files;
}

async function llmImport(
  claudeBin: string,
  model: string,
  files: MemoryFile[],
): Promise<z.infer<typeof MemoryImportSchema>['rules'] | null> {
  const notes = files
    .map((f) => `--- memory: ${f.name} (type: ${f.type}) ---\n${f.description}\n\n${f.body}`)
    .join('\n\n')
    .slice(0, 40_000);
  const json = await callClaudeJson(claudeBin, model, IMPORT_SYSTEM_PROMPT, `Memory notes:\n\n${notes}`);
  if (!json) return null;
  try {
    return MemoryImportSchema.parse(JSON.parse(json)).rules;
  } catch {
    return null;
  }
}

/** Deterministic fallback: one rule per memory note, from its description line. */
function fallbackRule(file: MemoryFile): z.infer<typeof MemoryImportSchema>['rules'][number] | null {
  const text = (file.description || file.body.split('\n')[0] || '').trim();
  if (text.length < 10) return null;
  return {
    rule_text: text.slice(0, 160),
    tech: null,
    category: bestCategory(`${file.name} ${text}`, 'general'),
    priority: 2,
    triggers: keywords(`${file.name} ${text}`).slice(0, 10),
    detail: file.body.slice(0, 2000) || null,
  };
}

function readImportedHashes(db: Db): Set<string> {
  try {
    const raw = getMeta(db, META_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
