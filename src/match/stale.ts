import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from '../db/database.js';
import { projectDbDir } from '../paths.js';

const LOCK_TTL_MS = 2 * 60 * 1000;

/**
 * Cheap staleness probe for the hook path: stat the watched stack manifests
 * and every indexed skill file, comparing mtime/size. ~50-90 stats, a few
 * microseconds each. Stack files first — they are fewer and change more
 * often mid-project (new dependency, new manifest appearing).
 */
export function isIndexStale(db: Db): boolean {
  if (stackFilesStale(db)) return true;
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
 * Stack manifest snapshot check. Absent candidates (present=0) are recorded
 * too, so a package.json appearing in a previously empty project is caught.
 */
function stackFilesStale(db: Db): boolean {
  let rows: { path: string; present: number; mtime_ms: number | null; size: number | null }[];
  try {
    rows = db.prepare('SELECT path, present, mtime_ms, size FROM stack_files').all() as typeof rows;
  } catch {
    return false; // pre-v2 schema: no table yet (the hook separately triggers a migrating sync)
  }
  for (const row of rows) {
    try {
      const st = fs.statSync(row.path);
      if (!row.present) return true; // manifest appeared
      if (Math.round(st.mtimeMs) !== row.mtime_ms || st.size !== row.size) return true;
    } catch {
      if (row.present) return true; // manifest deleted
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
