import fs from 'node:fs';
import { openProjectDb } from '../db/database.js';
import { getMeta, statusCounts } from '../db/queries.js';
import { loadConfig } from '../config.js';
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
    console.log(`Inactive     : ${counts.inactive} skills (not relevant to this project's stack)`);
    printStack(db);
    console.log('Skills:');
    for (const row of counts.skills) {
      console.log(`  ${row.scope.padEnd(8)} ${String(row.n).padStart(3)}  [${row.status}]`);
    }
    printOverrideWarnings(db, projectRoot);
    const stale = staleFileCount(db);
    if (stale > 0) {
      console.log(`\n⚠ ${stale} skill file(s) changed since last index — run \`skillsdb sync\`.`);
    }
  } finally {
    db.close();
  }
}

function printStack(db: ReturnType<typeof openProjectDb>): void {
  try {
    const raw = getMeta(db, 'stack_profile');
    if (!raw) return;
    const profile = JSON.parse(raw) as { languages: string[]; frameworks: string[] };
    console.log(
      `Stack        : ${profile.languages.join(', ') || 'none'}` +
        (profile.frameworks.length ? ` — ${profile.frameworks.join(', ')}` : ''),
    );
  } catch {
    // pre-v2 DB or unreadable meta: skip the line
  }
}

function printOverrideWarnings(db: ReturnType<typeof openProjectDb>, projectRoot: string): void {
  const config = loadConfig(projectRoot);
  const overrides = [...config.enabledSkills, ...config.disabledSkills];
  if (overrides.length === 0) return;
  const known = new Set(
    (db.prepare('SELECT name FROM skills').all() as { name: string }[]).map((s) => s.name),
  );
  const unknown = overrides.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    console.log(`\n⚠ config overrides name unknown skills: ${unknown.join(', ')}`);
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
