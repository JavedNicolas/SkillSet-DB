import { execFileSync, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db/database.js';
import type { SkillsetDbConfig } from '../config.js';
import type { ScannedSkill } from '../scan/scanner.js';
import { addCategory, categoryCount } from '../db/queries.js';
import { homeDir } from '../paths.js';
import { MAX_CATEGORIES, TAXONOMY_VERSION } from './taxonomy.js';
import { openExtractionCache } from './cache.js';
import { extractionSystemPrompt, extractionUserPrompt, RETRY_SUFFIX } from './prompts.js';
import { LlmExtractionSchema, type LlmExtraction } from './schema.js';
import type { ExtractedRule } from './types.js';

export type LlmExtractor = (skill: ScannedSkill) => Promise<ExtractedRule[] | null>;

const MAX_CONTENT_BYTES = 48_000;
const CALL_TIMEOUT_MS = 120_000;

/**
 * Build the LLM extractor backed by the headless claude CLI, with the global
 * content-hash cache. Returns null when the claude CLI is not available.
 */
export function makeLlmExtractor(db: Db, config: SkillsetDbConfig): LlmExtractor | null {
  const claudeBin = findClaudeBin();
  if (!claudeBin) return null;
  const cache = openExtractionCache();

  return async (skill: ScannedSkill): Promise<ExtractedRule[] | null> => {
    const cached = cache?.get(skill.contentHash);
    if (cached) return cached.map((r) => ({ ...r, sourceFile: skill.path }));

    const content = skillContent(skill);
    const userPrompt = extractionUserPrompt(skill.name, skill.description, content);
    const systemPrompt = extractionSystemPrompt(db);

    let extraction = await callClaude(claudeBin, config.extractionModel, systemPrompt, userPrompt);
    if (!extraction) {
      extraction = await callClaude(claudeBin, config.extractionModel, systemPrompt, userPrompt + RETRY_SUFFIX);
    }
    if (!extraction) return null;

    applyNewCategories(db, extraction);
    const known = knownCategories(db);
    const rules: ExtractedRule[] = extraction.rules.map((r) => ({
      title: r.title,
      ruleText: r.rule_text.length > 160 ? r.rule_text.slice(0, 159).trimEnd() + '…' : r.rule_text,
      category: known.has(r.category) ? r.category : 'general',
      priority: r.priority,
      triggers: [...new Set(r.triggers.map((t) => t.toLowerCase().trim()).filter(Boolean))],
      detail: r.detail ?? null,
      sourceFile: skill.path,
    }));

    cache?.put(skill.contentHash, rules, config.extractionModel, TAXONOMY_VERSION);
    return rules;
  };
}

/** Main body plus reference files that have no usable frontmatter of their own. */
function skillContent(skill: ScannedSkill): string {
  let content = skill.body;
  for (const ref of skill.references) {
    if (typeof ref.frontmatter.title === 'string' && ref.frontmatter.title.trim()) continue; // deterministic path
    content += `\n\n--- reference: ${path.basename(ref.path)} ---\n${ref.body}`;
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    content = truncateOnHeadings(content);
  }
  return content;
}

/** Keep whole h2 sections until the byte cap so we never cut mid-rule. */
function truncateOnHeadings(content: string): string {
  const sections = content.split(/^(?=## )/m);
  let out = '';
  for (const section of sections) {
    if (Buffer.byteLength(out + section, 'utf8') > MAX_CONTENT_BYTES) break;
    out += section;
  }
  return out || content.slice(0, MAX_CONTENT_BYTES);
}

async function callClaude(
  claudeBin: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<LlmExtraction | null> {
  const json = await callClaudeJson(claudeBin, model, systemPrompt, userPrompt);
  if (!json) return null;
  try {
    return LlmExtractionSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * Headless claude call returning the fence-stripped result string, with the
 * recursion guards every Skillset DB subprocess needs (tmpdir cwd, hooks
 * disabled, SKILLSET_DB_EXTRACTION env). Shared by extraction and activation.
 */
export async function callClaudeJson(
  claudeBin: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const args = [
    '-p',
    userPrompt,
    '--model',
    model,
    '--output-format',
    'json',
    '--system-prompt',
    systemPrompt,
    '--allowedTools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--settings',
    '{"hooks":{}}',
  ];

  const stdout = await new Promise<string | null>((resolve) => {
    execFile(
      claudeBin,
      args,
      {
        timeout: CALL_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        // recursion guard: never fire Skillset DB's own hook from extraction
        cwd: os.tmpdir(),
        env: { ...process.env, SKILLSET_DB_EXTRACTION: '1' },
      },
      (err, out) => resolve(err ? null : out),
    );
  });
  if (!stdout) return null;

  try {
    const envelope = JSON.parse(stdout);
    const result: unknown = envelope?.result;
    if (typeof result !== 'string') return null;
    return stripFences(result);
  } catch {
    return null;
  }
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence?.[1]) return fence[1];
  // some replies prepend prose: grab the outermost JSON object
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function applyNewCategories(db: Db, extraction: LlmExtraction): void {
  for (const cat of extraction.new_categories) {
    if (categoryCount(db) >= MAX_CATEGORIES) break;
    addCategory(db, cat.slug, cat.label, cat.keywords);
  }
}

function knownCategories(db: Db): Set<string> {
  const rows = db.prepare('SELECT slug FROM categories').all() as { slug: string }[];
  return new Set(rows.map((r) => r.slug));
}

export function findClaudeBin(): string | null {
  const override = process.env.SKILLSET_DB_CLAUDE_BIN;
  if (override && fs.existsSync(override)) return override;
  try {
    const found = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch {
    // not on PATH
  }
  const fallback = path.join(homeDir(), '.local', 'bin', 'claude');
  return fs.existsSync(fallback) ? fallback : null;
}
