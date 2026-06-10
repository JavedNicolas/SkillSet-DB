import fs from 'node:fs';
import path from 'node:path';
import { projectDbDir } from '../paths.js';
import type { MatchedRule } from './matcher.js';

const SESSION_FILE_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Per-session record of rule ids already injected, so task-list hooks
 * (TaskCreate/TodoWrite fire on every status update) never repeat rules the
 * model has already seen this session. Best-effort: any IO error degrades to
 * "no dedup", never to a failure.
 */
export function loadInjected(projectRoot: string, sessionId: string): Set<number> {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(projectRoot, sessionId), 'utf8'));
    return new Set(Array.isArray(raw.ids) ? raw.ids.filter((n: unknown) => typeof n === 'number') : []);
  } catch {
    return new Set();
  }
}

export function recordInjected(projectRoot: string, sessionId: string, rules: MatchedRule[]): void {
  if (rules.length === 0) return;
  try {
    const ids = loadInjected(projectRoot, sessionId);
    for (const rule of rules) ids.add(rule.id);
    fs.writeFileSync(sessionFile(projectRoot, sessionId), JSON.stringify({ ids: [...ids] }));
    cleanupOldSessions(projectRoot);
  } catch {
    // dedup is an optimization — never fatal
  }
}

function sessionFile(projectRoot: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'default';
  return path.join(projectDbDir(projectRoot), `session-${safe}.json`);
}

function cleanupOldSessions(projectRoot: string): void {
  try {
    const dir = projectDbDir(projectRoot);
    const now = Date.now();
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('session-') || !name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      if (now - fs.statSync(file).mtimeMs > SESSION_FILE_TTL_MS) fs.rmSync(file, { force: true });
    }
  } catch {
    // ignore
  }
}
