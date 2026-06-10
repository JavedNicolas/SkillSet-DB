import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './settings.js';

export function mcpJsonPath(projectRoot: string): string {
  return path.join(projectRoot, '.mcp.json');
}

/** Absolute paths of the built entries, resolved from the running bundle. */
export function distPaths(): { hookJs: string; cliJs: string } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return { hookJs: path.join(here, 'hook.js'), cliJs: path.join(here, 'cli.js') };
}

/** Hook command using absolute node + hook.js so PATH never matters. */
export function hookCommand(): string {
  return `"${process.execPath}" "${distPaths().hookJs}"`;
}

/**
 * Register the skillsdb MCP server in the project's .mcp.json
 * (merge, idempotent).
 */
export function installMcp(projectRoot: string): 'installed' | 'already-installed' {
  const file = mcpJsonPath(projectRoot);
  const config = readJson(file);
  if (typeof config.mcpServers !== 'object' || config.mcpServers === null) config.mcpServers = {};
  const servers = config.mcpServers as Record<string, unknown>;
  if (servers.skillsdb) return 'already-installed';
  servers.skillsdb = {
    type: 'stdio',
    command: process.execPath,
    args: [distPaths().cliJs, 'serve', '--mcp'],
  };
  writeJson(file, config);
  return 'installed';
}

export function removeMcp(projectRoot: string): boolean {
  const file = mcpJsonPath(projectRoot);
  const config = readJson(file);
  const servers = config.mcpServers as Record<string, unknown> | undefined;
  if (!servers || !servers.skillsdb) return false;
  delete servers.skillsdb;
  writeJson(file, config);
  return true;
}

export function mcpInstalled(projectRoot: string): boolean {
  const config = readJson(mcpJsonPath(projectRoot));
  const servers = config.mcpServers as Record<string, unknown> | undefined;
  return Boolean(servers?.skillsdb);
}
