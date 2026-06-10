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

const INSTRUCTIONS = `SkillsDB indexes every rule from the skills installed for this project.
A compact rule checklist is auto-injected on each user prompt; use these tools when you start
work in an area the injected rules don't cover, or to read a rule's full text via its R-number.`;

export async function serveMcp(cwd: string): Promise<void> {
  let db: Db | null = null;
  const projectRoot = findProjectRoot(cwd);

  function getDb(): Db {
    if (db) return db;
    if (!projectRoot) throw new Error('No SkillsDB index found — run `skillsdb init` in the project.');
    const dbPath = projectDbPath(projectRoot);
    if (!fs.existsSync(dbPath)) throw new Error(`SkillsDB database missing at ${dbPath} — run \`skillsdb init\`.`);
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return db;
  }

  const server = new McpServer({ name: 'skillsdb', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'skillsdb_match',
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
    'skillsdb_rules_by_category',
    {
      description: 'List all rules of one category, ordered by priority.',
      inputSchema: {
        category: z.string().describe('Category slug (see skillsdb_categories)'),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ category, limit }) => {
      const rows = getDb()
        .prepare(
          `SELECT r.id, r.priority, r.rule_text, s.name AS skill
           FROM rules r JOIN skills s ON s.id = r.skill_id
           WHERE r.category = ? AND s.shadowed_by IS NULL
           ORDER BY r.priority, r.id LIMIT ?`,
        )
        .all(category, limit ?? 50) as { id: number; priority: number; rule_text: string; skill: string }[];
      if (rows.length === 0) return text(`No rules in category "${category}".`);
      return text(rows.map((r) => `R${r.id} P${r.priority} [${r.skill}] ${r.rule_text}`).join('\n'));
    },
  );

  server.registerTool(
    'skillsdb_rule_detail',
    {
      description: 'Full detail of one rule by its R-number: complete text, source skill file path (readable with the Read tool), triggers.',
      inputSchema: { id: z.number().int().describe('Rule id (the N in "RN")') },
    },
    async ({ id }) => {
      const row = getDb()
        .prepare(
          `SELECT r.*, s.name AS skill, s.scope FROM rules r JOIN skills s ON s.id = r.skill_id WHERE r.id = ?`,
        )
        .get(id) as Record<string, unknown> | undefined;
      if (!row) return text(`No rule R${id}.`);
      const lines = [
        `R${row.id} [${row.skill} / ${row.scope}] priority P${row.priority} category ${row.category}`,
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
    'skillsdb_categories',
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
    'skillsdb_status',
    { description: 'Index health: skill/rule counts per scope and staleness.', inputSchema: {} },
    async () => {
      const counts = statusCounts(getDb());
      const skills = counts.skills.map((s) => `${s.scope}: ${s.n} [${s.status}]`).join(', ');
      return text(
        `Project: ${projectRoot}\nRules: ${counts.rules} in ${counts.categories} categories\nSkills: ${skills}\nShadowed: ${counts.shadowed}`,
      );
    },
  );

  await server.connect(new StdioServerTransport());
}

function text(value: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: value }] };
}
