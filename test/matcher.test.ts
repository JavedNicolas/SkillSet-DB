import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openProjectDb, type Db } from '../src/db/database.js';
import { matchRules, promptTokens, rulesByIds } from '../src/match/matcher.js';
import { formatRulesBlock } from '../src/match/format.js';

let tmpDir: string;
let db: Db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsdb-test-'));
  db = openProjectDb(path.join(tmpDir, 'test.db'));
  const skillId = db
    .prepare(
      `INSERT INTO skills (name, scope, path, dir_path, content_hash, extraction_status)
       VALUES ('flutter-architecture', 'user', '/x/SKILL.md', '/x', 'h1', 'heuristic')`,
    )
    .run().lastInsertRowid;
  const insert = db.prepare(
    `INSERT INTO rules (skill_id, source_file, category, title, rule_text, priority, triggers)
     VALUES (?, '/x/SKILL.md', ?, ?, ?, ?, ?)`,
  );
  insert.run(skillId, 'architecture', 'Feature isolation', 'Features never import each other.', 1, 'flutter feature bloc architecture import');
  insert.run(skillId, 'state-management', 'BLoC events', 'Use sealed classes for BLoC events.', 2, 'bloc cubit event state flutter .dart');
  insert.run(skillId, 'database', 'RLS always', 'Enable RLS on every table.', 1, 'supabase rls policy table migration postgres');
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('promptTokens', () => {
  it('lowercases, removes stopwords, dedupes, caps at 24', () => {
    const tokens = promptTokens('Add a new BLoC for the user profile BLoC');
    expect(tokens).toContain('bloc');
    expect(tokens).toContain('profile');
    expect(tokens).not.toContain('the');
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe('matchRules', () => {
  it('matches rules by trigger keywords', () => {
    const rules = matchRules(db, 'create a profile bloc with events');
    const texts = rules.map((r) => r.ruleText);
    expect(texts).toContain('Use sealed classes for BLoC events.');
    expect(texts).not.toContain('Enable RLS on every table.');
  });

  it('matches database rules for a migration prompt', () => {
    const rules = matchRules(db, 'write a supabase migration with rls policies');
    expect(rules.map((r) => r.ruleText)).toContain('Enable RLS on every table.');
  });

  it('respects maxRules', () => {
    const rules = matchRules(db, 'flutter bloc rls supabase architecture', { maxRules: 1 });
    expect(rules.length).toBe(1);
  });

  it('excludes shadowed skills', () => {
    const winner = db
      .prepare(
        `INSERT INTO skills (name, scope, path, dir_path, content_hash, extraction_status)
         VALUES ('flutter-architecture', 'project', '/p/SKILL.md', '/p', 'h2', 'heuristic')`,
      )
      .run().lastInsertRowid;
    db.prepare('UPDATE skills SET shadowed_by = ? WHERE path = ?').run(winner, '/x/SKILL.md');
    const rules = matchRules(db, 'create a profile bloc with events');
    expect(rules.length).toBe(0);
  });

  it('returns empty for empty prompt without throwing', () => {
    expect(matchRules(db, '')).toEqual([]);
  });

  it('excludes inactive skills from FTS, fallback, and id lookup', () => {
    db.prepare(`UPDATE skills SET active = 0, inactive_reason = 'fallback: foreign stack'`).run();
    expect(matchRules(db, 'create a profile bloc with events')).toEqual([]);
    expect(matchRules(db, 'something vague entirely')).toEqual([]); // category fallback path
    const ids = (db.prepare('SELECT id FROM rules').all() as { id: number }[]).map((r) => r.id);
    expect(rulesByIds(db, ids, 10)).toEqual([]);
  });
});

describe('formatRulesBlock', () => {
  it('groups by category and includes rule ids', () => {
    const rules = matchRules(db, 'profile bloc with sealed events');
    const block = formatRulesBlock(rules);
    expect(block).toContain('<skillsdb-rules>');
    expect(block).toContain('[state-management]');
    expect(block).toMatch(/R\d+ P\d/);
  });

  it('returns empty string for no rules', () => {
    expect(formatRulesBlock([])).toBe('');
  });
});
