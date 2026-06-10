import fs from 'node:fs';
import { openProjectDb } from '../db/database.js';
import { statusCounts } from '../db/queries.js';
import { findProjectRoot, projectDbPath } from '../paths.js';

export function statusCommand(cwd: string): void {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }
  const dbPath = projectDbPath(projectRoot);
  const db = openProjectDb(dbPath, { readonly: true });
  try {
    const counts = statusCounts(db);
    const dbSize = fs.statSync(dbPath).size;
    console.log(`Project root : ${projectRoot}`);
    console.log(`Database     : ${dbPath} (${(dbSize / 1024).toFixed(0)} KB)`);
    console.log(`Rules        : ${counts.rules}`);
    console.log(`Categories   : ${counts.categories}`);
    console.log(`Shadowed     : ${counts.shadowed} skills`);
    console.log('Skills:');
    for (const row of counts.skills) {
      console.log(`  ${row.scope.padEnd(8)} ${String(row.n).padStart(3)}  [${row.status}]`);
    }
    const stale = staleFileCount(db);
    if (stale > 0) {
      console.log(`\n⚠ ${stale} skill file(s) changed since last index — run \`skillsdb sync\`.`);
    }
  } finally {
    db.close();
  }
}

function staleFileCount(db: ReturnType<typeof openProjectDb>): number {
  const rows = db.prepare('SELECT path, mtime_ms, size FROM files').all() as {
    path: string;
    mtime_ms: number;
    size: number;
  }[];
  let stale = 0;
  for (const row of rows) {
    try {
      const st = fs.statSync(row.path);
      if (Math.round(st.mtimeMs) !== row.mtime_ms || st.size !== row.size) stale++;
    } catch {
      stale++; // deleted
    }
  }
  return stale;
}
