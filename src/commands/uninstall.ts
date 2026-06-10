import fs from 'node:fs';
import path from 'node:path';
import { projectDbDir, SKILLSDB_DIR } from '../paths.js';
import { removeHook } from '../install/settings.js';
import { removeMcp } from '../install/mcp.js';

export interface UninstallOptions {
  purge?: boolean;
}

export function uninstallCommand(cwd: string, options: UninstallOptions): void {
  const projectRoot = path.resolve(cwd);
  console.log(removeHook(projectRoot) ? 'Hook removed from .claude/settings.json' : 'No hook entry found');
  console.log(removeMcp(projectRoot) ? 'MCP server removed from .mcp.json' : 'No MCP entry found');
  if (options.purge) {
    fs.rmSync(projectDbDir(projectRoot), { recursive: true, force: true });
    console.log(`Removed ${SKILLSDB_DIR}/`);
  } else {
    console.log(`Index kept at ${SKILLSDB_DIR}/ — pass --purge to delete it.`);
  }
}
