import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATION_V2_SQL, SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';
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

const MIGRATIONS: Record<number, (db: Db) => void> = {
  1: (db) => {
    db.exec(SCHEMA_SQL);
    seedCategories(db);
  },
  2: (db) => {
    db.exec(MIGRATION_V2_SQL);
  },
};

function migrate(db: Db): void {
  let version = db.pragma('user_version', { simple: true }) as number;
  while (version < SCHEMA_VERSION) {
    version++;
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`No migration to schema version ${version}`);
    db.transaction(() => {
      step(db);
      db.pragma(`user_version = ${version}`);
    })();
  }
}

/** Current schema version of an open DB — used to version-gate v2-only SQL
 * on the readonly hook path, where migration cannot run. */
export function schemaVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function seedCategories(db: Db): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO categories (slug, label, keywords, is_seed) VALUES (?, ?, ?, 1)`,
  );
  for (const c of SEED_CATEGORIES) {
    insert.run(c.slug, c.label, c.keywords.join(' '));
  }
}
