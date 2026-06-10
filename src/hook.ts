/**
 * UserPromptSubmit hook entry — the product's hot path.
 *
 * Contract: NEVER block the user's prompt. On any error print nothing and
 * exit 0. Kept deliberately slim (better-sqlite3 + matcher only) so Node
 * cold-start stays low on every prompt.
 */
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { loadConfig } from './config.js';
import { matchRules } from './match/matcher.js';
import { formatRulesBlock } from './match/format.js';
import { findProjectRoot, projectDbPath } from './paths.js';

async function main(): Promise<void> {
  if (process.env.SKILLSDB_EXTRACTION === '1') return;

  const input = JSON.parse(await readStdin(2000));
  const prompt: string = typeof input.prompt === 'string' ? input.prompt : '';
  const cwd: string = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  if (!prompt.trim()) return;

  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return;
  const dbPath = projectDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return;

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const config = loadConfig(projectRoot);
    const rules = matchRules(db, prompt.slice(0, 4000), {
      tokenBudget: config.tokenBudget,
      maxRules: config.maxRules,
    });
    const block = formatRulesBlock(rules);
    if (block) process.stdout.write(block + '\n');
  } finally {
    db.close();
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
