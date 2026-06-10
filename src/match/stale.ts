import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/database.js';
import { projectDbDir } from '../paths.js';

const LOCK_TTL_MS = 2 * 60 * 1000;

/**
 * Cheap staleness probe for the hook path: stat every indexed file and
 * compare mtime/size. ~30-60 stats, well under a millisecond each.
 */
export function isIndexStale(db: Db): boolean {
  const rows = db.prepare('SELECT path, mtime_ms, size FROM files').all() as {
    path: string;
    mtime_ms: number;
    size: number;
  }[];
  for (const row of rows) {
    try {
      const st = fs.statSync(row.path);
      if (Math.round(st.mtimeMs) !== row.mtime_ms || st.size !== row.size) return true;
    } catch {
      return true; // deleted
    }
  }
  return false;
}

/**
 * Kick off `skillsdb sync` detached so the NEXT prompt sees fresh rules,
 * without ever blocking this one. A lockfile keeps concurrent prompts from
 * stampeding.
 */
export function triggerBackgroundSync(projectRoot: string): void {
  const lockPath = path.join(projectDbDir(projectRoot), 'sync.lock');
  try {
    const st = fs.statSync(lockPath);
    if (Date.now() - st.mtimeMs < LOCK_TTL_MS) return; // a sync is already running
  } catch {
    // no lock — proceed
  }
  try {
    fs.writeFileSync(lockPath, String(process.pid));
    const cliJs = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.js');
    const child = spawn(process.execPath, [cliJs, 'sync'], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // background sync is best-effort
  }
}

/** Called by the sync command when it finishes, so the lock never wedges. */
export function releaseSyncLock(projectRoot: string): void {
  try {
    fs.rmSync(path.join(projectDbDir(projectRoot), 'sync.lock'), { force: true });
  } catch {
    // ignore
  }
}
