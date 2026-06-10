import fs from 'node:fs';
import path from 'node:path';

interface HookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

const MARKER = 'skillsdb';

export function settingsPath(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'settings.json');
}

/**
 * Merge the SkillsDB UserPromptSubmit hook into the project's
 * .claude/settings.json. Append-only and idempotent: existing hooks
 * (e.g. ruflo's) are never touched, and re-running init never duplicates.
 */
export function installHook(projectRoot: string, hookCommand: string): 'installed' | 'already-installed' {
  const file = settingsPath(projectRoot);
  const settings = readJson(file);

  if (typeof settings.hooks !== 'object' || settings.hooks === null) settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown>;
  if (!Array.isArray(hooks.UserPromptSubmit)) hooks.UserPromptSubmit = [];
  const entries = hooks.UserPromptSubmit as HookEntry[];

  if (hasSkillsdbHook(entries)) return 'already-installed';

  entries.push({ hooks: [{ type: 'command', command: hookCommand, timeout: 5 }] });
  writeJson(file, settings);
  return 'installed';
}

export function removeHook(projectRoot: string): boolean {
  const file = settingsPath(projectRoot);
  const settings = readJson(file);
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks.UserPromptSubmit)) return false;
  const entries = hooks.UserPromptSubmit as HookEntry[];
  const kept = entries.filter((e) => !isSkillsdbEntry(e));
  if (kept.length === entries.length) return false;
  hooks.UserPromptSubmit = kept;
  writeJson(file, settings);
  return true;
}

export function hookInstalled(projectRoot: string): boolean {
  const settings = readJson(settingsPath(projectRoot));
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  return Array.isArray(hooks?.UserPromptSubmit) && hasSkillsdbHook(hooks.UserPromptSubmit as HookEntry[]);
}

function hasSkillsdbHook(entries: HookEntry[]): boolean {
  return entries.some(isSkillsdbEntry);
}

function isSkillsdbEntry(entry: HookEntry): boolean {
  return (
    Array.isArray(entry?.hooks) &&
    entry.hooks.some((h) => typeof h?.command === 'string' && h.command.toLowerCase().includes(MARKER))
  );
}

export function readJson(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
