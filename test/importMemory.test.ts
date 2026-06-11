import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openProjectDb, type Db } from '../src/db/database.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { importMemoryRules, memoryDirForProject } from '../src/memory/importMemory.js';

let tmpProject: string;
let tmpHome: string;
let db: Db;

const config = { ...DEFAULT_CONFIG, noLlm: true };

function writeMemory(name: string, type: string, description: string, body: string): void {
  const dir = memoryDirForProject(tmpProject);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n---\n\n${body}\n`,
  );
}

beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsdb-import-proj-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'skillsdb-import-home-'));
  process.env.SKILLSDB_HOME_OVERRIDE = tmpHome;
  db = openProjectDb(path.join(tmpProject, '.skillsdb', 'skillsdb.db'));
});

afterEach(() => {
  db.close();
  delete process.env.SKILLSDB_HOME_OVERRIDE;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('importMemoryRules', () => {
  it('no memory dir: clean no-op', async () => {
    const summary = await importMemoryRules(db, tmpProject, config, { noLlm: true });
    expect(summary).toEqual({ scanned: 0, imported: 0, skipped: 0, method: 'none' });
  });

  it('imports feedback memories as project-scoped remembered rules (fallback path)', async () => {
    writeMemory(
      'git-commit-preferences',
      'feedback',
      'Commit often in logical working units, never broken code, unsigned commits',
      '**Why:** user asked.\n**How to apply:** commit per feature after tests pass.',
    );
    writeMemory('some-link', 'reference', 'Dashboard link', 'https://example.com');
    const summary = await importMemoryRules(db, tmpProject, config, { noLlm: true });
    expect(summary.imported).toBe(1); // reference type excluded
    expect(summary.method).toBe('fallback');

    const rule = db
      .prepare(`SELECT r.rule_text, s.scope, s.name FROM rules r JOIN skills s ON s.id = r.skill_id`)
      .get() as { rule_text: string; scope: string; name: string };
    expect(rule.rule_text).toContain('Commit often');
    expect(rule.scope).toBe('project');
    expect(rule.name).toMatch(/^skillsdb-memory-/);
    // the generated skill file exists in the project
    expect(fs.existsSync(path.join(tmpProject, '.claude', 'skills', rule.name, 'SKILL.md'))).toBe(true);
  });

  it('never imports the same memory twice; new memories still import', async () => {
    writeMemory('rule-one', 'feedback', 'Always run the linter before committing changes', 'Body.');
    await importMemoryRules(db, tmpProject, config, { noLlm: true });
    const second = await importMemoryRules(db, tmpProject, config, { noLlm: true });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(1);

    writeMemory('rule-two', 'project', 'Never deploy on Fridays without approval', 'Body.');
    const third = await importMemoryRules(db, tmpProject, config, { noLlm: true });
    expect(third.imported).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number }).n).toBe(2);
  });

  it('skips MEMORY.md index and unreadable frontmatter gracefully', async () => {
    const dir = memoryDirForProject(tmpProject);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory Index\n- [x](x.md)\n');
    const summary = await importMemoryRules(db, tmpProject, config, { noLlm: true });
    expect(summary.scanned).toBe(0);
  });
});
