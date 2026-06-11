import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { CACHE_SCHEMA_SQL } from '../db/schema.js';
import { globalCacheDir } from '../paths.js';
import type { ExtractedRule } from './types.js';

export interface ExtractionCache {
  get(contentHash: string): ExtractedRule[] | null;
  put(contentHash: string, rules: ExtractedRule[], model: string, taxonomyVersion: number): void;
  close(): void;
}

/**
 * Global cross-project cache at ~/.skillset-db/extraction-cache.db: a skill
 * content hash is extracted once ever, on any project.
 */
export function openExtractionCache(): ExtractionCache | null {
  try {
    const dir = globalCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, 'extraction-cache.db'));
    db.pragma('journal_mode = WAL');
    db.exec(CACHE_SCHEMA_SQL);
    return {
      get(contentHash) {
        const row = db.prepare('SELECT rules_json FROM extraction_cache WHERE content_hash = ?').get(contentHash) as
          | { rules_json: string }
          | undefined;
        if (!row) return null;
        try {
          return JSON.parse(row.rules_json) as ExtractedRule[];
        } catch {
          return null;
        }
      },
      put(contentHash, rules, model, taxonomyVersion) {
        db.prepare(
          `INSERT OR REPLACE INTO extraction_cache (content_hash, rules_json, model, taxonomy_version, extracted_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(contentHash, JSON.stringify(rules), model, taxonomyVersion, new Date().toISOString());
      },
      close() {
        db.close();
      },
    };
  } catch {
    return null; // cache is an optimization — never fatal
  }
}
