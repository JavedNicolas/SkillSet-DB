import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openProjectDb, type Db } from '../src/db/database.js';
import { rulesByIds, type MatchedRule } from '../src/match/matcher.js';
import { clearSession, loadInjected, recordInjected } from '../src/match/session.js';
import { projectDbDir } from '../src/paths.js';

let tmpDir: string;
let db: Db;

function rule(id: number): MatchedRule {
  return { id, category: 'general', priority: 2, title: 't', ruleText: 'r', skill: 's', score: -1 };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillset-db-session-'));
  fs.mkdirSync(projectDbDir(tmpDir), { recursive: true });
  db = openProjectDb(path.join(tmpDir, '.skillset-db', 'skillset-db.db'));
  const skillId = db
    .prepare(
      `INSERT INTO skills (name, scope, path, dir_path, content_hash, extraction_status)
       VALUES ('s', 'user', '/x/SKILL.md', '/x', 'h', 'heuristic')`,
    )
    .run().lastInsertRowid;
  const insert = db.prepare(
    `INSERT INTO rules (id, skill_id, source_file, category, title, rule_text, priority, triggers)
     VALUES (?, ?, '/x/SKILL.md', 'general', ?, ?, ?, 'kw')`,
  );
  insert.run(1, skillId, 'low', 'Low priority rule', 3);
  insert.run(2, skillId, 'critical', 'Critical rule', 1);
  insert.run(3, skillId, 'mid', 'Mid rule', 2);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('rulesByIds', () => {
  it('returns requested rules ordered by priority', () => {
    const rules = rulesByIds(db, [1, 2, 3], 10);
    expect(rules.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('respects the limit (P1 kept first)', () => {
    const rules = rulesByIds(db, [1, 2, 3], 2);
    expect(rules.map((r) => r.id)).toEqual([2, 3]);
  });

  it('returns empty for empty ids', () => {
    expect(rulesByIds(db, [], 10)).toEqual([]);
  });

  it('ignores unknown ids', () => {
    expect(rulesByIds(db, [999], 10)).toEqual([]);
  });
});

describe('session record', () => {
  it('records, loads, and clears injected ids', () => {
    recordInjected(tmpDir, 'sess1', [rule(1), rule(2)]);
    expect([...loadInjected(tmpDir, 'sess1')].sort()).toEqual([1, 2]);
    recordInjected(tmpDir, 'sess1', [rule(3)]);
    expect(loadInjected(tmpDir, 'sess1').size).toBe(3);
    clearSession(tmpDir, 'sess1');
    expect(loadInjected(tmpDir, 'sess1').size).toBe(0);
  });

  it('isolates sessions', () => {
    recordInjected(tmpDir, 'a', [rule(1)]);
    expect(loadInjected(tmpDir, 'b').size).toBe(0);
  });
});
