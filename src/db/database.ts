import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
import { SEED_CATEGORIES } from '../extract/taxonomy.js';

export type Db = Database.Database;

export function openProjectDb(dbPath: string, options?: { readonly?: boolean }): Db {
  if (options?.readonly) {
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current >= SCHEMA_VERSION) return;
  db.exec(SCHEMA_SQL);
  seedCategories(db);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

function seedCategories(db: Db): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO categories (slug, label, keywords, is_seed) VALUES (?, ?, ?, 1)`,
  );
  for (const c of SEED_CATEGORIES) {
    insert.run(c.slug, c.label, c.keywords.join(' '));
  }
}
