import fs from 'node:fs';
import path from 'node:path';
import { findProjectRoot, globalCacheDir, projectDbDir } from '../paths.js';

export interface ClearOptions {
  /** Also clear the global extraction cache (~/.skillsdb). */
  cache?: boolean;
}

/**
 * Drop the project's rules database (and session/lock files). Config, hook
 * and MCP registration, and generated memory skill FILES are kept — run
 * `skillsdb index` to rebuild. Rebuilding is cheap: extraction is served
 * from the global cache unless --cache wipes that too.
 */
export function clearCommand(cwd: string, options: ClearOptions): void {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }
  const dbDir = projectDbDir(projectRoot);
  let removed = 0;
  for (const name of fs.readdirSync(dbDir)) {
    if (name === 'config.json' || name === '.gitignore') continue;
    fs.rmSync(path.join(dbDir, name), { recursive: true, force: true });
    removed++;
  }
  console.log(`Cleared the project index (${removed} file(s) in ${dbDir}; config kept).`);

  if (options.cache) {
    const cacheDir = globalCacheDir();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    console.log(`Cleared the global extraction cache at ${cacheDir} — the next index re-extracts every skill.`);
  }
  console.log('Run `skillsdb index` to rebuild.');
}
