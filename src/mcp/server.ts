import fs from 'node:fs';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import Database from 'better-sqlite3';
import type { Db } from '../db/database.js';
import { statusCounts } from '../db/queries.js';
import { loadConfig } from '../config.js';
import { findProjectRoot, projectDbPath } from '../paths.js';
import { matchRules } from '../match/matcher.js';
import { formatRulesHuman } from '../match/format.js';

const INSTRUCTIONS = `Skillset DB indexes every rule from the skills installed for this project.
A compact rule checklist is auto-injected on each user prompt; use these tools when you start
work in an area the injected rules don't cover, or to read a rule's full text via its R-number.

IMPORTANT: when the user states a lasting rule, preference, or correction that should persist
beyond this conversation ("always X", "never Y", "from now on...") and it is not already covered
by an existing rule, save it with skillset_db_remember. Provide precise trigger keywords (synonyms,
framework names, file extensions) — they drive when the rule resurfaces.`;

export async function serveMcp(cwd: string): Promise<void> {
  let db: Db | null = null;
  const projectRoot = findProjectRoot(cwd);

  function getDb(): Db {
    if (db) return db;
    if (!projectRoot) throw new Error('No Skillset DB index found — run `skillset-db init` in the project.');
    const dbPath = projectDbPath(projectRoot);
    if (!fs.existsSync(dbPath)) throw new Error(`Skillset DB database missing at ${dbPath} — run \`skillset-db init\`.`);
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return db;
  }

  const server = new McpServer({ name: 'skillset-db', version: '0.1.1' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'skillset_db_match',
    {
      description:
        'Match a task description against the rules database and return the applicable rules. Use before starting work on a topic not covered by already-injected rules.',
      inputSchema: {
        query: z.string().describe('Free-text task description, e.g. "add a supabase migration"'),
        category: z.string().optional().describe('Restrict to one category slug'),
        limit: z.number().int().min(1).max(50).optional().describe('Max rules (default 15)'),
      },
    },
    async ({ query, category, limit }) => {
      const database = getDb();
      const config = projectRoot ? loadConfig(projectRoot) : undefined;
      const rules = matchRules(database, query, {
        category,
        maxRules: limit ?? config?.maxRules ?? 15,
        tokenBudget: 10_000,
      });
      return text(formatRulesHuman(rules));
    },
  );

  server.registerTool(
    'skillset_db_rules_by_category',
    {
      description: 'List all rules of one category, ordered by priority.',
      inputSchema: {
        category: z.string().describe('Category slug (see skillset_db_categories)'),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ category, limit }) => {
      const rows = getDb()
        .prepare(
          `SELECT r.id, r.priority, r.rule_text, s.name AS skill
           FROM rules r JOIN skills s ON s.id = r.skill_id
           WHERE r.category = ? AND s.shadowed_by IS NULL AND s.active = 1
           ORDER BY r.priority, r.id LIMIT ?`,
        )
        .all(category, limit ?? 50) as { id: number; priority: number; rule_text: string; skill: string }[];
      if (rows.length === 0) return text(`No rules in category "${category}".`);
      return text(rows.map((r) => `R${r.id} P${r.priority} [${r.skill}] ${r.rule_text}`).join('\n'));
    },
  );

  server.registerTool(
    'skillset_db_rule_detail',
    {
      description: 'Full detail of one rule by its R-number: complete text, source skill file path (readable with the Read tool), triggers.',
      inputSchema: { id: z.number().int().describe('Rule id (the N in "RN")') },
    },
    async ({ id }) => {
      const row = getDb()
        .prepare(
          `SELECT r.*, s.name AS skill, s.scope, s.active FROM rules r JOIN skills s ON s.id = r.skill_id WHERE r.id = ?`,
        )
        .get(id) as Record<string, unknown> | undefined;
      if (!row) return text(`No rule R${id}.`);
      const lines = [
        `R${row.id} [${row.skill} / ${row.scope}] priority P${row.priority} category ${row.category}` +
          (row.active ? '' : ' (skill inactive for this project)'),
        `Title: ${row.title}`,
        `Rule: ${row.rule_text}`,
        row.detail ? `Detail:\n${row.detail}` : null,
        `Source file: ${row.source_file}`,
        `Triggers: ${row.triggers}`,
      ].filter(Boolean);
      return text(lines.join('\n'));
    },
  );

  server.registerTool(
    'skillset_db_remember',
    {
      description:
        'Persist a rule the user stated in conversation so it is injected in future sessions. Stored globally as a generated skill (skillset-db-memory-<tech>) usable even without Skillset DB. Use when the user expresses a lasting rule/preference/correction not covered by existing rules.',
      inputSchema: {
        rule: z.string().min(5).max(300).describe('ONE imperative sentence, self-contained'),
        tech: z
          .string()
          .optional()
          .describe('Framework/language bucket: flutter, react, typescript, supabase... Omit for the detected stack; "general" for stack-agnostic rules'),
        category: z.string().optional().describe('Category slug (see skillset_db_categories)'),
        priority: z.number().int().min(1).max(4).optional().describe('1 critical .. 4 info (default 2)'),
        triggers: z
          .array(z.string())
          .min(3)
          .max(15)
          .describe('Lowercase keywords a task description would contain when this rule applies: synonyms, verbs, framework names, file-extension hints'),
        detail: z.string().max(2000).optional().describe('Optional longer explanation or example'),
      },
    },
    async ({ rule, tech, category, priority, triggers, detail }) => {
      if (!projectRoot) throw new Error('No Skillset DB index found — run `skillset-db init` in the project.');
      const { rememberRule } = await import('../memory/remember.js');
      const { openProjectDb } = await import('../db/database.js');
      const writeDb = openProjectDb(projectDbPath(projectRoot));
      try {
        const result = await rememberRule(writeDb, projectRoot, 'global', {
          ruleText: rule,
          tech,
          category,
          priority,
          triggers,
          detail,
        });
        return text(
          `Remembered globally in ${result.skillName}: "${rule}". It is indexed and will be injected when relevant in every project using ${result.tech}.`,
        );
      } finally {
        writeDb.close();
      }
    },
  );

  server.registerTool(
    'skillset_db_forget',
    {
      description: 'Remove a previously remembered rule by its R-number (only skillset-db-memory rules).',
      inputSchema: { id: z.number().int().describe('Rule id (the N in "RN")') },
    },
    async ({ id }) => {
      if (!projectRoot) throw new Error('No Skillset DB index found.');
      const { forgetRule } = await import('../memory/remember.js');
      const { openProjectDb } = await import('../db/database.js');
      const writeDb = openProjectDb(projectDbPath(projectRoot));
      try {
        const removed = await forgetRule(writeDb, id);
        return text(removed ? `Forgot rule R${id}.` : `R${id} is not a remembered rule — cannot forget it.`);
      } finally {
        writeDb.close();
      }
    },
  );

  server.registerTool(
    'skillset_db_categories',
    { description: 'List the rule categories with their rule counts.', inputSchema: {} },
    async () => {
      const rows = getDb()
        .prepare(
          `SELECT c.slug, c.label, COUNT(r.id) AS n FROM categories c
           LEFT JOIN rules r ON r.category = c.slug GROUP BY c.slug ORDER BY n DESC`,
        )
        .all() as { slug: string; label: string; n: number }[];
      return text(rows.map((r) => `${r.slug} (${r.label}): ${r.n} rules`).join('\n'));
    },
  );

  server.registerTool(
    'skillset_db_status',
    { description: 'Index health: skill/rule counts per scope and staleness.', inputSchema: {} },
    async () => {
      const counts = statusCounts(getDb());
      const skills = counts.skills.map((s) => `${s.scope}: ${s.n} [${s.status}]`).join(', ');
      return text(
        `Project: ${projectRoot}\nRules: ${counts.rules} in ${counts.categories} categories\nSkills: ${skills}\nShadowed: ${counts.shadowed}\nInactive for this project: ${counts.inactive}`,
      );
    },
  );

  await server.connect(new StdioServerTransport());
}

function text(value: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: value }] };
}
