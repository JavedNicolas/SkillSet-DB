import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openProjectDb, type Db } from '../src/db/database.js';
import { forgetRule, rememberRule } from '../src/memory/remember.js';
import { matchRules } from '../src/match/matcher.js';

let tmpProject: string;
let tmpHome: string;
let db: Db;

beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'skillset-db-mem-proj-'));
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'skillset-db-mem-home-'));
  process.env.SKILLSET_DB_HOME_OVERRIDE = tmpHome;
  db = openProjectDb(path.join(tmpProject, '.skillset-db', 'skillset-db.db'));
});

afterEach(() => {
  db.close();
  delete process.env.SKILLSET_DB_HOME_OVERRIDE;
  fs.rmSync(tmpProject, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('rememberRule', () => {
  it('global scope writes the generated skill under the home skills dir and indexes it', async () => {
    const result = await rememberRule(db, tmpProject, 'global', {
      ruleText: 'Never use var; always declare explicit types.',
      tech: 'typescript',
      priority: 1,
      triggers: ['var', 'types', 'declaration', '.ts'],
    });
    expect(result.skillName).toBe('skillset-db-memory-typescript');
    expect(result.skillDir).toBe(path.join(tmpHome, '.claude', 'skills', 'skillset-db-memory-typescript'));
    expect(fs.existsSync(result.referencePath)).toBe(true);
    const skillMd = fs.readFileSync(path.join(result.skillDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('generator: skillset-db');
    expect(skillMd).toContain('Never use var; always declare explicit types.');

    // indexed, active, exact metadata preserved, matchable
    const rule = db
      .prepare(`SELECT r.priority, r.triggers, s.active, s.scope FROM rules r JOIN skills s ON s.id = r.skill_id`)
      .get() as { priority: number; triggers: string; active: number; scope: string };
    expect(rule.priority).toBe(1);
    expect(rule.active).toBe(1);
    expect(rule.scope).toBe('user');
    expect(rule.triggers).toContain('var');
    const matched = matchRules(db, 'declare a var in this typescript file');
    expect(matched.map((r) => r.ruleText).join(' ')).toContain('Never use var');
  });

  it('project scope writes into the project .claude/skills', async () => {
    const result = await rememberRule(db, tmpProject, 'project', {
      ruleText: 'Always use the AppButton widget for buttons.',
      tech: 'flutter',
    });
    expect(result.skillDir).toBe(path.join(tmpProject, '.claude', 'skills', 'skillset-db-memory-flutter'));
    const skill = db.prepare('SELECT scope FROM skills').get() as { scope: string };
    expect(skill.scope).toBe('project');
  });

  it('exactly one rule per remember; no duplicates from the SKILL.md body mirror', async () => {
    await rememberRule(db, tmpProject, 'global', { ruleText: 'Always run tests before committing.', tech: 'general' });
    await rememberRule(db, tmpProject, 'global', { ruleText: 'Never push directly to main.', tech: 'general' });
    const count = (db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number }).n;
    expect(count).toBe(2);
  });

  it('slug collisions get suffixes', async () => {
    await rememberRule(db, tmpProject, 'global', { ruleText: 'Always do the thing.', tech: 'general' });
    const second = await rememberRule(db, tmpProject, 'global', { ruleText: 'Always do the thing!', tech: 'general' });
    expect(second.referencePath).toMatch(/-2\.md$/);
  });
});

describe('forgetRule', () => {
  it('removes the reference file and the rule; deletes the skill when empty', async () => {
    const result = await rememberRule(db, tmpProject, 'global', {
      ruleText: 'Never hardcode hex colors.',
      tech: 'flutter',
    });
    const ruleId = (db.prepare('SELECT id FROM rules').get() as { id: number }).id;
    expect(await forgetRule(db, ruleId)).toBe(true);
    expect(fs.existsSync(result.referencePath)).toBe(false);
    expect(fs.existsSync(result.skillDir)).toBe(false);
    expect((db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM skills').get() as { n: number }).n).toBe(0);
  });

  it('keeps the skill and regenerates SKILL.md when other rules remain', async () => {
    await rememberRule(db, tmpProject, 'global', { ruleText: 'Rule one stays here.', tech: 'general' });
    await rememberRule(db, tmpProject, 'global', { ruleText: 'Rule two gets removed.', tech: 'general' });
    const id = (
      db.prepare(`SELECT id FROM rules WHERE rule_text LIKE 'Rule two%'`).get() as { id: number }
    ).id;
    expect(await forgetRule(db, id)).toBe(true);
    const skillMd = fs.readFileSync(
      path.join(tmpHome, '.claude', 'skills', 'skillset-db-memory-general', 'SKILL.md'),
      'utf8',
    );
    expect(skillMd).toContain('Rule one');
    expect(skillMd).not.toContain('Rule two');
    expect((db.prepare('SELECT COUNT(*) AS n FROM rules').get() as { n: number }).n).toBe(1);
  });

  it('refuses to forget a non-memory rule', async () => {
    db.prepare(
      `INSERT INTO skills (name, scope, path, dir_path, content_hash, extraction_status)
       VALUES ('real-skill', 'user', '/x/SKILL.md', '/x', 'h', 'heuristic')`,
    ).run();
    db.prepare(
      `INSERT INTO rules (skill_id, source_file, category, title, rule_text, priority, triggers)
       VALUES (1, '/x/SKILL.md', 'general', 'T', 'A normal skill rule.', 2, 'kw')`,
    ).run();
    expect(await forgetRule(db, 1)).toBe(false);
  });
});
