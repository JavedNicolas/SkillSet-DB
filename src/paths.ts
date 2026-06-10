import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SkillScope = 'project' | 'user' | 'agents' | 'plugin';

export interface SkillRoot {
  scope: SkillScope;
  dir: string;
}

export const SKILLSDB_DIR = '.skillsdb';
export const DB_FILENAME = 'skillsdb.db';

export function homeDir(): string {
  return process.env.SKILLSDB_HOME_OVERRIDE ?? os.homedir();
}

export function globalCacheDir(): string {
  return path.join(homeDir(), '.skillsdb');
}

export function projectDbDir(projectRoot: string): string {
  return path.join(projectRoot, SKILLSDB_DIR);
}

export function projectDbPath(projectRoot: string): string {
  return path.join(projectDbDir(projectRoot), DB_FILENAME);
}

/** Walk up from `startDir` looking for a `.skillsdb/skillsdb.db`. */
export function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, SKILLSDB_DIR, DB_FILENAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Skill roots merged for a project, in precedence order
 * (project > user > agents > plugin).
 */
export function skillRoots(projectRoot: string): SkillRoot[] {
  const home = homeDir();
  const roots: SkillRoot[] = [
    { scope: 'project', dir: path.join(projectRoot, '.claude', 'skills') },
    { scope: 'user', dir: path.join(home, '.claude', 'skills') },
    { scope: 'agents', dir: path.join(home, '.agents', 'skills') },
  ];
  return [...roots.filter((r) => isDir(r.dir)), ...pluginSkillRoots()];
}

/**
 * Skill directories of enabled plugins, resolved from
 * `~/.claude/settings.json#enabledPlugins` (keys like "ruflo-core@ruflo")
 * against `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills`.
 * Picks the lexicographically highest version dir when several are cached.
 */
export function pluginSkillRoots(): SkillRoot[] {
  const home = homeDir();
  const settingsPath = path.join(home, '.claude', 'settings.json');
  let enabled: Record<string, unknown> = {};
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings && typeof settings.enabledPlugins === 'object') {
      enabled = settings.enabledPlugins;
    }
  } catch {
    return [];
  }

  const roots: SkillRoot[] = [];
  for (const [key, value] of Object.entries(enabled)) {
    if (!value) continue;
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const plugin = key.slice(0, at);
    const marketplace = key.slice(at + 1);
    const pluginDir = path.join(home, '.claude', 'plugins', 'cache', marketplace, plugin);
    if (!isDir(pluginDir)) continue;
    const versions = fs
      .readdirSync(pluginDir)
      .filter((v) => isDir(path.join(pluginDir, v)))
      .sort();
    const latest = versions[versions.length - 1];
    if (!latest) continue;
    const skillsDir = path.join(pluginDir, latest, 'skills');
    if (isDir(skillsDir)) roots.push({ scope: 'plugin', dir: skillsDir });
  }
  return roots;
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
