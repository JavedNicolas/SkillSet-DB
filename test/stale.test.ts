import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openProjectDb, type Db } from '../src/db/database.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { applyActivation } from '../src/detect/activation.js';
import { isIndexStale } from '../src/match/stale.js';

let tmpDir: string;
let db: Db;

const config = { ...DEFAULT_CONFIG, noLlm: true };

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillset-db-stale-'));
  db = openProjectDb(path.join(tmpDir, '.skillset-db', 'skillset-db.db'));
  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { react: '18' } }));
  await applyActivation(db, tmpDir, config, {}); // writes the stack_files snapshot
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('stack-aware staleness probe', () => {
  it('fresh snapshot is not stale', () => {
    expect(isIndexStale(db)).toBe(false);
  });

  it('modified manifest is stale', () => {
    const manifest = path.join(tmpDir, 'package.json');
    fs.writeFileSync(manifest, JSON.stringify({ dependencies: { react: '18', next: '14' } }));
    expect(isIndexStale(db)).toBe(true);
  });

  it('a manifest APPEARING is stale (absent candidate tracked)', () => {
    fs.writeFileSync(path.join(tmpDir, 'pubspec.yaml'), 'dependencies:\n  flutter:\n    sdk: flutter\n');
    expect(isIndexStale(db)).toBe(true);
  });

  it('deleted manifest is stale', () => {
    fs.rmSync(path.join(tmpDir, 'package.json'));
    expect(isIndexStale(db)).toBe(true);
  });
});
