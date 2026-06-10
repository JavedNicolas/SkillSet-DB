/**
 * Hook entry — the product's hot path. Handles two events:
 *  - UserPromptSubmit: match the user's prompt, print the rules block (stdout
 *    is injected as context).
 *  - PostToolUse on ExitPlanMode: match the approved plan text (much richer
 *    than a vague prompt), inject via hookSpecificOutput.additionalContext.
 *
 * Contract: NEVER block the user. On any error print nothing and exit 0.
 * Kept deliberately slim (better-sqlite3 + matcher only) so Node cold-start
 * stays low on every prompt.
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { loadConfig } from './config.js';
import { matchRules } from './match/matcher.js';
import { formatRulesBlock } from './match/format.js';
import { isIndexStale, triggerBackgroundSync } from './match/stale.js';
import { findProjectRoot, projectDbPath } from './paths.js';

async function main(): Promise<void> {
  if (process.env.SKILLSDB_EXTRACTION === '1') return;

  const input = JSON.parse(await readStdin(2000));
  const isPlanApproval = input.hook_event_name === 'PostToolUse';
  const text = isPlanApproval ? planText(input) : typeof input.prompt === 'string' ? input.prompt : '';
  const cwd: string = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  if (!text.trim()) return;

  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return;
  const dbPath = projectDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return;

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const config = loadConfig(projectRoot);
    const rules = matchRules(db, text.slice(0, 8000), {
      tokenBudget: config.tokenBudget,
      maxRules: config.maxRules,
    });
    let stale = false;
    try {
      stale = isIndexStale(db);
      if (stale) triggerBackgroundSync(projectRoot);
    } catch {
      // staleness handling is best-effort
    }
    const block = formatRulesBlock(rules, { stale, heading: isPlanApproval ? 'plan' : 'prompt' });
    if (!block) return;
    if (isPlanApproval) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: block },
        }) + '\n',
      );
    } else {
      process.stdout.write(block + '\n');
    }
  } finally {
    db.close();
  }
}

/**
 * The approved plan text. Older Claude Code versions pass it as
 * tool_input.plan; newer ones return it in the tool response — collect every
 * string we can find (the matcher tokenizes lexically, so shape noise is
 * harmless).
 */
function planText(input: Record<string, unknown>): string {
  if (input.tool_name !== 'ExitPlanMode') return '';
  const parts: string[] = [];
  const toolInput = input.tool_input as Record<string, unknown> | undefined;
  if (typeof toolInput?.plan === 'string') parts.push(toolInput.plan);
  collectStrings(input.tool_response, parts, 0);
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
