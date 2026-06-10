import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hookInstalled, installHook, removeHook, settingsPath } from '../src/install/settings.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsdb-install-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const CMD = '"/usr/bin/node" "/opt/skillsdb/dist/hook.js"';

describe('installHook', () => {
  it('creates settings.json when missing', () => {
    expect(installHook(tmpDir, CMD)).toBe('installed');
    const settings = JSON.parse(fs.readFileSync(settingsPath(tmpDir), 'utf8'));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(hookInstalled(tmpDir)).toBe(true);
  });

  it('registers a PostToolUse hook scoped to ExitPlanMode', () => {
    installHook(tmpDir, CMD);
    const settings = JSON.parse(fs.readFileSync(settingsPath(tmpDir), 'utf8'));
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0].matcher).toBe('ExitPlanMode');
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe(CMD);
  });

  it('completes a partial install (only UserPromptSubmit present)', () => {
    installHook(tmpDir, CMD);
    const settings = JSON.parse(fs.readFileSync(settingsPath(tmpDir), 'utf8'));
    delete settings.hooks.PostToolUse;
    fs.writeFileSync(settingsPath(tmpDir), JSON.stringify(settings));
    expect(hookInstalled(tmpDir)).toBe(false);
    expect(installHook(tmpDir, CMD)).toBe('installed');
    const fixed = JSON.parse(fs.readFileSync(settingsPath(tmpDir), 'utf8'));
    expect(fixed.hooks.UserPromptSubmit).toHaveLength(1); // not duplicated
    expect(fixed.hooks.PostToolUse).toHaveLength(1);
  });

  it('preserves existing hooks and other settings', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'));
    fs.writeFileSync(
      settingsPath(tmpDir),
      JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'npx ruflo hooks route' }] }] },
        permissions: { allow: ['Bash(ls:*)'] },
      }),
    );
    installHook(tmpDir, CMD);
    const settings = JSON.parse(fs.readFileSync(settingsPath(tmpDir), 'utf8'));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('npx ruflo hooks route');
    expect(settings.permissions.allow).toEqual(['Bash(ls:*)']);
  });

  it('is idempotent', () => {
    installHook(tmpDir, CMD);
    expect(installHook(tmpDir, CMD)).toBe('already-installed');
    const settings = JSON.parse(fs.readFileSync(settingsPath(tmpDir), 'utf8'));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('removeHook removes only the skillsdb entries', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'));
    fs.writeFileSync(
      settingsPath(tmpDir),
      JSON.stringify({
        hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'npx ruflo hooks route' }] }] },
      }),
    );
    installHook(tmpDir, CMD);
    expect(removeHook(tmpDir)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath(tmpDir), 'utf8'));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe('npx ruflo hooks route');
    expect(settings.hooks.PostToolUse).toHaveLength(0);
  });
});
