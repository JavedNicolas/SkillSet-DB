import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openProjectDb, type Db } from '../src/db/database.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import {
  applyActivation,
  fallbackActivation,
  type ActivationDecision,
  type LlmActivator,
} from '../src/detect/activation.js';
import type { StackProfile } from '../src/detect/stack.js';

let tmpDir: string;
let db: Db;

function insertSkill(name: string, scope: string, description = ''): void {
  db.prepare(
    `INSERT INTO skills (name, scope, path, dir_path, content_hash, description, extraction_status)
     VALUES (?, ?, ?, ?, 'h', ?, 'heuristic')`,
  ).run(name, scope, `/${scope}/${name}/SKILL.md`, `/${scope}/${name}`, description);
}

function skillState(name: string): { active: number; inactive_reason: string | null } {
  return db
    .prepare('SELECT active, inactive_reason FROM skills WHERE name = ? AND shadowed_by IS NULL')
    .get(name) as { active: number; inactive_reason: string | null };
}

function flutterBlocProject(): void {
  fs.writeFileSync(
    path.join(tmpDir, 'pubspec.yaml'),
    'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  flutter_bloc: ^8.0.0\n',
  );
}

const config = { ...DEFAULT_CONFIG, noLlm: true };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillset-db-activation-'));
  db = openProjectDb(path.join(tmpDir, '.skillset-db', 'skillset-db.db'));
  insertSkill('flutter-bloc-arch', 'user', 'Flutter clean architecture with BLoC and freezed');
  insertSkill('flutter-riverpod', 'user', 'Flutter state management with Riverpod providers');
  insertSkill('git-hygiene', 'user', 'Commit message and branching conventions');
  insertSkill('project-rules', 'project', 'Rules specific to this project');
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('fallbackActivation', () => {
  const profile: StackProfile = {
    languages: ['dart'],
    frameworks: ['flutter', 'bloc'],
    dependencies: ['flutter', 'flutter_bloc'],
    manifests: ['pubspec.yaml'],
    extensions: {},
  };

  it('deactivates skills naming a foreign tech, keeps agnostic and matching ones', () => {
    const decisions = fallbackActivation(profile, [
      { name: 'flutter-riverpod', description: 'Riverpod state management for Flutter', scope: 'user' },
      { name: 'flutter-bloc-arch', description: 'Flutter BLoC architecture', scope: 'user' },
      { name: 'git-hygiene', description: 'Commit conventions', scope: 'user' },
      { name: 'django-rules', description: 'Django ORM best practices', scope: 'user' },
    ]);
    const byName = new Map(decisions.map((d) => [d.skill, d]));
    expect(byName.get('flutter-riverpod')?.active).toBe(false);
    expect(byName.get('flutter-bloc-arch')?.active).toBe(true);
    expect(byName.get('git-hygiene')?.active).toBe(true);
    expect(byName.get('django-rules')?.active).toBe(false);
  });
});

describe('applyActivation', () => {
  it('empty project: everything stays active', async () => {
    const summary = await applyActivation(db, tmpDir, config, {});
    expect(summary.method).toBe('none');
    expect(skillState('flutter-riverpod').active).toBe(1);
    expect(skillState('git-hygiene').active).toBe(1);
  });

  it('detected stack + fallback: foreign skill deactivated, project scope always active', async () => {
    flutterBlocProject();
    const summary = await applyActivation(db, tmpDir, config, {});
    expect(summary.method).toBe('fallback');
    expect(skillState('flutter-riverpod').active).toBe(0);
    expect(skillState('flutter-riverpod').inactive_reason).toContain('riverpod');
    expect(skillState('flutter-bloc-arch').active).toBe(1);
    expect(skillState('git-hygiene').active).toBe(1);
    expect(skillState('project-rules').active).toBe(1);
  });

  it('LLM activator used, cached by stack+skillset hash, re-run on stack change', async () => {
    flutterBlocProject();
    const decisions: ActivationDecision[] = [
      { skill: 'flutter-riverpod', active: false, reason: 'project uses bloc' },
      { skill: 'flutter-bloc-arch', active: true, reason: 'matches' },
      { skill: 'git-hygiene', active: true, reason: 'agnostic' },
    ];
    const llmActivate = vi.fn<LlmActivator>().mockResolvedValue(decisions);

    const first = await applyActivation(db, tmpDir, config, { llmActivate });
    expect(first.method).toBe('llm');
    expect(skillState('flutter-riverpod').active).toBe(0);

    const second = await applyActivation(db, tmpDir, config, { llmActivate });
    expect(second.method).toBe('cached');
    expect(llmActivate).toHaveBeenCalledTimes(1);

    // stack change: riverpod added -> re-evaluate
    fs.appendFileSync(path.join(tmpDir, 'pubspec.yaml'), '  flutter_riverpod: ^2.0.0\n');
    llmActivate.mockResolvedValue(decisions.map((d) => ({ ...d, active: true })));
    const third = await applyActivation(db, tmpDir, config, { llmActivate });
    expect(third.method).toBe('llm');
    expect(llmActivate).toHaveBeenCalledTimes(2);
    expect(skillState('flutter-riverpod').active).toBe(1);
  });

  it('fails open: LLM returns null -> fallback; missing decision -> active', async () => {
    flutterBlocProject();
    const llmActivate = vi.fn<LlmActivator>().mockResolvedValue(null);
    const summary = await applyActivation(db, tmpDir, config, { llmActivate });
    expect(summary.method).toBe('fallback');

    // partial decisions: unmentioned skill defaults active (real dep added so the stack hash changes)
    fs.appendFileSync(path.join(tmpDir, 'pubspec.yaml'), '  http: ^1.0.0\n');
    const partial = vi.fn<LlmActivator>().mockResolvedValue([
      { skill: 'flutter-riverpod', active: false, reason: 'bloc project' },
    ]);
    await applyActivation(db, tmpDir, config, { llmActivate: partial });
    expect(skillState('flutter-riverpod').active).toBe(0);
    expect(skillState('git-hygiene').active).toBe(1);
  });

  it('config overrides beat auto decisions; enabled wins over disabled', async () => {
    flutterBlocProject();
    const overridden = {
      ...config,
      enabledSkills: ['flutter-riverpod'],
      disabledSkills: ['flutter-riverpod', 'git-hygiene'],
    };
    await applyActivation(db, tmpDir, overridden, {});
    expect(skillState('flutter-riverpod').active).toBe(1); // enabled wins the tie
    expect(skillState('git-hygiene').active).toBe(0);
    expect(skillState('git-hygiene').inactive_reason).toBe('config: disabledSkills');
  });

  it('init selection applies only while no stack exists, then auto takes over', async () => {
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('init_selection', ?)`).run(
      JSON.stringify(['git-hygiene']),
    );
    await applyActivation(db, tmpDir, config, {});
    expect(skillState('git-hygiene').active).toBe(1);
    expect(skillState('flutter-bloc-arch').active).toBe(0);
    expect(skillState('flutter-bloc-arch').inactive_reason).toBe('init: not selected');

    // stack appears: auto layer outranks init selection
    flutterBlocProject();
    await applyActivation(db, tmpDir, config, {});
    expect(skillState('flutter-bloc-arch').active).toBe(1);
    expect(skillState('flutter-riverpod').active).toBe(0);
  });

  it('writes the stack snapshot for the staleness probe, absent candidates included', async () => {
    flutterBlocProject();
    await applyActivation(db, tmpDir, config, {});
    const rows = db.prepare('SELECT present, COUNT(*) AS n FROM stack_files GROUP BY present').all() as {
      present: number;
      n: number;
    }[];
    const present = rows.find((r) => r.present === 1)?.n ?? 0;
    const absent = rows.find((r) => r.present === 0)?.n ?? 0;
    expect(present).toBeGreaterThanOrEqual(1);
    expect(absent).toBeGreaterThan(5);
  });
});
