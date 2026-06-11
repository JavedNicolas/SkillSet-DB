import type { Db } from '../db/database.js';

export interface MatchedRule {
  id: number;
  category: string;
  priority: number;
  title: string;
  ruleText: string;
  skill: string;
  score: number;
}

export interface MatchOptions {
  tokenBudget?: number;
  maxRules?: number;
  category?: string;
  limit?: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'with', 'without',
  'for', 'from', 'into', 'this', 'that', 'these', 'those', 'is', 'are', 'was', 'were',
  'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'can', 'may', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'of', 'to',
  'in', 'on', 'at', 'by', 'as', 'not', 'no', 'so', 'please', 'want', 'need', 'make',
  'just', 'some', 'there', 'here', 'now', 'new', 'add', 'get', 'let', 'also', 'how',
  'what', 'which', 'where', 'why', 'who',
]);

const PRIORITY_WEIGHT: Record<number, number> = { 1: 1.6, 2: 1.2, 3: 1.0, 4: 0.7 };

/**
 * SQL fragment excluding deactivated skills. Version-gated: the hook opens
 * the DB readonly and may meet a pre-v2 schema with no `active` column —
 * migration happens on the next write-path sync.
 */
function activeFilter(db: Db): string {
  const version = db.pragma('user_version', { simple: true }) as number;
  return version >= 2 ? 'AND s.active = 1' : '';
}

/** Match a free-text task description against the rules database. */
export function matchRules(db: Db, prompt: string, options: MatchOptions = {}): MatchedRule[] {
  const tokenBudget = options.tokenBudget ?? 800;
  const maxRules = options.maxRules ?? 15;
  const ftsLimit = options.limit ?? 60;

  const tokens = promptTokens(prompt);
  let candidates: MatchedRule[] = tokens.length > 0 ? ftsQuery(db, tokens, options.category, ftsLimit) : [];

  if (candidates.length < 3) {
    const fallback = categoryFallback(db, tokens, options.category, ftsLimit);
    const seen = new Set(candidates.map((r) => r.id));
    candidates = [...candidates, ...fallback.filter((r) => !seen.has(r.id))];
  }

  // bm25 scores are negative (more negative = better); priority amplifies.
  candidates.sort((a, b) => a.score * weight(a.priority) - b.score * weight(b.priority));

  return budgetFill(candidates, tokenBudget, maxRules);
}

/**
 * Fetch specific rules by id (shadowed skills excluded), P1 first.
 * Used to re-state already-injected rules after compaction and to seed
 * subagent context with the session's active rules.
 */
export function rulesByIds(db: Db, ids: number[], limit: number): MatchedRule[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT r.id, r.category, r.priority, r.title, r.rule_text AS ruleText,
              s.name AS skill, -1.0 AS score
       FROM rules r JOIN skills s ON s.id = r.skill_id
       WHERE r.id IN (${placeholders}) AND s.shadowed_by IS NULL ${activeFilter(db)}
       ORDER BY r.priority, r.id LIMIT ?`,
    )
    .all(...ids, limit) as MatchedRule[];
}

export function promptTokens(prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 3 && w.length <= 40 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 24);
}

function ftsQuery(db: Db, tokens: string[], category: string | undefined, limit: number): MatchedRule[] {
  const match = tokens.map((t) => `"${t}"`).join(' OR ');
  const categoryFilter = category ? 'AND r.category = ?' : '';
  const args: unknown[] = category ? [match, category, limit] : [match, limit];
  try {
    const rows = db
      .prepare(
        `SELECT r.id, r.category, r.priority, r.title, r.rule_text AS ruleText,
                s.name AS skill, bm25(rules_fts, 4.0, 2.0, 8.0, 3.0) AS score
         FROM rules_fts
         JOIN rules r ON r.id = rules_fts.rowid
         JOIN skills s ON s.id = r.skill_id
         WHERE rules_fts MATCH ? AND s.shadowed_by IS NULL ${activeFilter(db)} ${categoryFilter}
         ORDER BY score LIMIT ?`,
      )
      .all(...args) as MatchedRule[];
    return rows;
  } catch {
    return []; // malformed FTS query must never break the hook
  }
}

/**
 * Fallback channel when FTS finds little: categories whose keyword maps
 * overlap the prompt contribute their highest-priority rules.
 */
function categoryFallback(db: Db, tokens: string[], category: string | undefined, limit: number): MatchedRule[] {
  let slugs: string[];
  if (category) {
    slugs = [category];
  } else {
    const cats = db.prepare('SELECT slug, keywords FROM categories').all() as { slug: string; keywords: string }[];
    slugs = cats
      .filter((c) => {
        const kws = new Set(c.keywords.split(/\s+/).filter(Boolean));
        return tokens.some((t) => kws.has(t) || [...kws].some((k) => k.length >= 4 && t.startsWith(k)));
      })
      .map((c) => c.slug);
  }
  if (slugs.length === 0) return [];
  const placeholders = slugs.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT r.id, r.category, r.priority, r.title, r.rule_text AS ruleText,
              s.name AS skill, -1.0 AS score
       FROM rules r JOIN skills s ON s.id = r.skill_id
       WHERE r.category IN (${placeholders}) AND s.shadowed_by IS NULL ${activeFilter(db)} AND r.priority <= 2
       ORDER BY r.priority, r.id LIMIT ?`,
    )
    .all(...slugs, limit) as MatchedRule[];
}

/** Greedy budget fill: P1 rules first, then best-ranked until budget/count caps. */
function budgetFill(candidates: MatchedRule[], tokenBudget: number, maxRules: number): MatchedRule[] {
  const ordered = [...candidates.filter((r) => r.priority === 1), ...candidates.filter((r) => r.priority !== 1)];
  const picked: MatchedRule[] = [];
  let tokens = 0;
  for (const rule of ordered) {
    if (picked.length >= maxRules) break;
    const cost = estimateTokens(rule);
    if (tokens + cost > tokenBudget) continue;
    picked.push(rule);
    tokens += cost;
  }
  return picked;
}

function estimateTokens(rule: MatchedRule): number {
  return Math.ceil((rule.ruleText.length + rule.skill.length + 12) / 4);
}

function weight(priority: number): number {
  return PRIORITY_WEIGHT[priority] ?? 1.0;
}
