import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openProjectDb, schemaVersion } from '../src/db/database.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from '../src/db/schema.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsdb-migration-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildV1Db(dbPath: string): void {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA_SQL);
  db.prepare(`INSERT INTO categories (slug, label, keywords, is_seed) VALUES ('general','General','',1)`).run();
  const skillId = db
    .prepare(
      `INSERT INTO skills (name, scope, path, dir_path, content_hash, extraction_status)
       VALUES ('legacy', 'user', '/x/SKILL.md', '/x', 'h', 'heuristic')`,
    )
    .run().lastInsertRowid;
  db.prepare(
    `INSERT INTO rules (skill_id, source_file, category, title, rule_text, priority, triggers)
     VALUES (?, '/x/SKILL.md', 'general', 'T', 'Always do the legacy thing.', 1, 'legacy thing')`,
  ).run(skillId);
  db.pragma('user_version = 1');
  db.close();
}

describe('schema migration', () => {
  it('fresh DB lands on the current version with v2 tables', () => {
    const db = openProjectDb(path.join(tmpDir, 'fresh.db'));
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(() => db.prepare('SELECT key FROM meta').all()).not.toThrow();
    expect(() => db.prepare('SELECT path FROM stack_files').all()).not.toThrow();
    expect(db.prepare('SELECT active FROM skills LIMIT 1')).toBeDefined();
    db.close();
  });

  it('migrates a v1 DB in place, defaulting skills to active', () => {
    const dbPath = path.join(tmpDir, 'v1.db');
    buildV1Db(dbPath);
    const db = openProjectDb(dbPath);
    expect(schemaVersion(db)).toBe(2);
    const skill = db.prepare('SELECT name, active, inactive_reason FROM skills').get() as {
      name: string;
      active: number;
      inactive_reason: string | null;
    };
    expect(skill.name).toBe('legacy');
    expect(skill.active).toBe(1);
    expect(skill.inactive_reason).toBeNull();
    // data and FTS survive
    const hit = db
      .prepare(`SELECT rowid FROM rules_fts WHERE rules_fts MATCH '"legacy"'`)
      .all();
    expect(hit.length).toBe(1);
    db.close();
  });

  it('schemaVersion reads a readonly v1 DB without migrating it', () => {
    const dbPath = path.join(tmpDir, 'v1ro.db');
    buildV1Db(dbPath);
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(schemaVersion(db)).toBe(1);
    db.close();
  });
});
