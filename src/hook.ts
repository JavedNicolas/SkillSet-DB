/**
 * Hook entry — the product's hot path. Handles every SkillsDB hook event:
 *  - UserPromptSubmit: match the user's prompt, print the rules block (stdout
 *    is injected as context).
 *  - PostToolUse on ExitPlanMode: match the approved plan text (much richer
 *    than a vague prompt), inject via hookSpecificOutput.additionalContext.
 *  - PostToolUse on TaskCreate/TodoWrite: match Claude's own task list — the
 *    moment it decides what to do after a vague prompt. Deduped per session
 *    so status updates never re-inject rules the model already saw.
 *  - SessionStart: awareness block on startup/resume/clear; after compaction
 *    (source=compact) re-state the session's already-injected rules, which
 *    the compacted context may have dropped.
 *  - SubagentStart: seed the subagent (blind to main-conversation context)
 *    with the session's active rules.
 *  - SessionEnd: drop the session's dedup record.
 *
 * Contract: NEVER block the user. On any error print nothing and exit 0.
 * Kept deliberately slim (better-sqlite3 + matcher only) so Node cold-start
 * stays low on every prompt.
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { loadConfig } from './config.js';
import { matchRules, rulesByIds } from './match/matcher.js';
import { formatRulesBlock, formatStatusBlock } from './match/format.js';
import { clearSession, loadInjected, recordInjected } from './match/session.js';
import { isIndexStale, triggerBackgroundSync } from './match/stale.js';
import { findProjectRoot, projectDbPath } from './paths.js';

type EventKind = 'prompt' | 'plan' | 'tasks';

const SUBAGENT_MAX_RULES = 10;

async function main(): Promise<void> {
  if (process.env.SKILLSDB_EXTRACTION === '1') return;

  const input = JSON.parse(await readStdin(2000));
  const event: unknown = input.hook_event_name;
  const cwd: string = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const sessionId: string = typeof input.session_id === 'string' ? input.session_id : 'default';

  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return;

  if (event === 'SessionEnd') {
    clearSession(projectRoot, sessionId);
    return;
  }

  const dbPath = projectDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (event === 'SessionStart') {
      handleSessionStart(db, input, projectRoot, sessionId);
      return;
    }
    if (event === 'SubagentStart') {
      handleSubagentStart(db, projectRoot, sessionId);
      return;
    }
    handleTextMatch(db, input, projectRoot, sessionId);
  } finally {
    db.close();
  }
}

/** UserPromptSubmit + PostToolUse(plan/tasks): lexical match on event text. */
function handleTextMatch(
  db: Database.Database,
  input: Record<string, unknown>,
  projectRoot: string,
  sessionId: string,
): void {
  const parsed = parseEvent(input);
  if (!parsed) return;
  const { kind, text } = parsed;

  const config = loadConfig(projectRoot);
  let rules = matchRules(db, text.slice(0, 8000), {
    tokenBudget: config.tokenBudget,
    maxRules: config.maxRules,
  });

  // plan/tasks fire mid-session: only inject rules not already seen.
  // Prompt injections are never filtered (each user message stands alone)
  // but are recorded so later task hooks don't repeat them.
  if (kind !== 'prompt') {
    const seen = loadInjected(projectRoot, sessionId);
    rules = rules.filter((r) => !seen.has(r.id));
  }
  if (rules.length === 0) return;
  recordInjected(projectRoot, sessionId, rules);

  const block = formatRulesBlock(rules, { stale: staleProbe(db, projectRoot), heading: kind });
  if (kind === 'prompt') {
    process.stdout.write(block + '\n');
  } else {
    writeAdditionalContext('PostToolUse', block);
  }
}

/**
 * startup/resume: tiny awareness block. clear: same, after dropping the
 * dedup record (the context was wiped). compact: re-state the session's
 * already-injected rules — compaction may have summarized them away while
 * the dedup record still marks them as seen.
 */
function handleSessionStart(
  db: Database.Database,
  input: Record<string, unknown>,
  projectRoot: string,
  sessionId: string,
): void {
  const source = typeof input.source === 'string' ? input.source : 'startup';
  staleProbe(db, projectRoot); // refresh the index before the first prompt

  if (source === 'compact') {
    const seen = [...loadInjected(projectRoot, sessionId)];
    const config = loadConfig(projectRoot);
    const rules = rulesByIds(db, seen, config.maxRules);
    if (rules.length === 0) return;
    writeAdditionalContext('SessionStart', formatRulesBlock(rules, { heading: 'compact' }));
    return;
  }

  if (source === 'clear') clearSession(projectRoot, sessionId);
  const block = formatStatusBlock(statusForBlock(db));
  if (block) writeAdditionalContext('SessionStart', block);
}

/** Subagents never see main-conversation injections — seed them with the
 * session's active rules (P1 first). Silent before anything matched. */
function handleSubagentStart(db: Database.Database, projectRoot: string, sessionId: string): void {
  const seen = [...loadInjected(projectRoot, sessionId)];
  const rules = rulesByIds(db, seen, SUBAGENT_MAX_RULES);
  if (rules.length === 0) return;
  writeAdditionalContext('SubagentStart', formatRulesBlock(rules, { heading: 'subagent' }));
}

function statusForBlock(db: Database.Database): { rules: number; categories: number; skills: number } {
  const version = db.pragma('user_version', { simple: true }) as number;
  const active = version >= 2 ? 'AND s.active = 1' : '';
  const row = db
    .prepare(
      `SELECT COUNT(r.id) AS rules, COUNT(DISTINCT r.category) AS categories,
              COUNT(DISTINCT r.skill_id) AS skills
       FROM rules r JOIN skills s ON s.id = r.skill_id WHERE s.shadowed_by IS NULL ${active}`,
    )
    .get() as { rules: number; categories: number; skills: number };
  return row;
}

function staleProbe(db: Database.Database, projectRoot: string): boolean {
  try {
    // pre-v2 DB under a v2 binary: a write-path sync migrates it
    const version = db.pragma('user_version', { simple: true }) as number;
    const stale = version < 2 || isIndexStale(db);
    if (stale) triggerBackgroundSync(projectRoot);
    return stale;
  } catch {
    return false; // staleness handling is best-effort
  }
}

function writeAdditionalContext(hookEventName: string, additionalContext: string): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } }) + '\n');
}

function parseEvent(input: Record<string, unknown>): { kind: EventKind; text: string } | null {
  if (input.hook_event_name === 'PostToolUse') {
    const tool = input.tool_name;
    if (tool === 'ExitPlanMode') {
      const text = planText(input);
      return text.trim() ? { kind: 'plan', text } : null;
    }
    if (tool === 'TaskCreate' || tool === 'TodoWrite') {
      const text = taskText(input);
      return text.trim() ? { kind: 'tasks', text } : null;
    }
    return null;
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  return prompt.trim() ? { kind: 'prompt', text: prompt } : null;
}

/**
 * The approved plan text. Older Claude Code versions pass it as
 * tool_input.plan; newer ones return it in the tool response — collect every
 * string we can find (the matcher tokenizes lexically, so shape noise is
 * harmless).
 */
function planText(input: Record<string, unknown>): string {
  const parts: string[] = [];
  const toolInput = input.tool_input as Record<string, unknown> | undefined;
  if (typeof toolInput?.plan === 'string') parts.push(toolInput.plan);
  collectStrings(input.tool_response, parts, 0);
  return parts.join('\n');
}

/** Task subjects/descriptions from TaskCreate, todo contents from TodoWrite. */
function taskText(input: Record<string, unknown>): string {
  const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof toolInput.subject === 'string') parts.push(toolInput.subject);
  if (typeof toolInput.description === 'string') parts.push(toolInput.description);
  if (Array.isArray(toolInput.todos)) {
    for (const todo of toolInput.todos) {
      const content = (todo as Record<string, unknown>)?.content;
      if (typeof content === 'string') parts.push(content);
    }
  }
  return parts.join('\n');
}

function collectStrings(value: unknown, out: string[], depth: number): void {
  if (depth > 4 || out.join('').length > 16_000) return;
  if (typeof value === 'string') {
    if (value.length > 20) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out, depth + 1);
  }
}

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
