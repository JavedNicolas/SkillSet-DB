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
 * Hook events SkillsDB registers:
 *  - UserPromptSubmit: match every user prompt
 *  - PostToolUse on ExitPlanMode: match the approved plan text
 *  - PostToolUse on TaskCreate/TodoWrite: match Claude's own task list, the
 *    decision moment after a vague prompt in non-plan mode
 *  - SessionStart: awareness block; on source=compact, re-state rules the
 *    compaction may have dropped
 *  - SubagentStart: seed subagents with the session's active rules
 *  - SessionEnd: drop the session's dedup record
 */
const HOOK_EVENTS: { event: string; matcher?: string }[] = [
  { event: 'UserPromptSubmit' },
  { event: 'PostToolUse', matcher: 'ExitPlanMode|TaskCreate|TodoWrite' },
  { event: 'SessionStart' },
  { event: 'SubagentStart' },
  { event: 'SessionEnd' },
];

/**
 * Merge the SkillsDB hooks into the project's .claude/settings.json.
 * Append-only and idempotent: existing hooks (e.g. ruflo's) are never
 * touched, and re-running init never duplicates. An existing skillsdb entry
 * with an outdated matcher is upgraded in place.
 */
export function installHook(projectRoot: string, hookCommand: string): 'installed' | 'already-installed' {
  const file = settingsPath(projectRoot);
  const settings = readJson(file);

  if (typeof settings.hooks !== 'object' || settings.hooks === null) settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown>;

  let changed = false;
  for (const { event, matcher } of HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) hooks[event] = [];
    const entries = hooks[event] as HookEntry[];
    const existing = entries.find(isSkillsdbEntry);
    if (existing) {
      if (matcher && existing.matcher !== matcher) {
        existing.matcher = matcher;
        changed = true;
      }
      continue;
    }
    const entry: HookEntry = { hooks: [{ type: 'command', command: hookCommand, timeout: 5 }] };
    if (matcher) entry.matcher = matcher;
    entries.push(entry);
    changed = true;
  }
  if (!changed) return 'already-installed';
  writeJson(file, settings);
  return 'installed';
}

export function removeHook(projectRoot: string): boolean {
  const file = settingsPath(projectRoot);
  const settings = readJson(file);
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks) return false;
  let removed = false;
  for (const { event } of HOOK_EVENTS) {
    if (!Array.isArray(hooks[event])) continue;
    const entries = hooks[event] as HookEntry[];
    const kept = entries.filter((e) => !isSkillsdbEntry(e));
    if (kept.length !== entries.length) {
      hooks[event] = kept;
      removed = true;
    }
  }
  if (removed) writeJson(file, settings);
  return removed;
}

export function hookInstalled(projectRoot: string): boolean {
  const settings = readJson(settingsPath(projectRoot));
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  return HOOK_EVENTS.every(
    ({ event }) => Array.isArray(hooks?.[event]) && hasSkillsdbHook(hooks[event] as HookEntry[]),
  );
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
