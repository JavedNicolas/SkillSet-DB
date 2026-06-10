import { describe, expect, it } from 'vitest';
import { dedupeSkills } from '../src/scan/dedupe.js';
import type { ScannedSkill } from '../src/scan/scanner.js';

function skill(name: string, scope: ScannedSkill['scope'], path: string): ScannedSkill {
  return {
    name,
    scope,
    path,
    dirPath: path.replace(/\/[^/]+$/, ''),
    contentHash: 'h',
    description: '',
    frontmatter: {},
    body: '',
    files: [],
    references: [],
  };
}

describe('dedupeSkills', () => {
  it('project shadows user and plugin', () => {
    const result = dedupeSkills([
      skill('supabase', 'user', '/u/supabase/SKILL.md'),
      skill('supabase', 'project', '/p/supabase/SKILL.md'),
      skill('supabase', 'plugin', '/pl/supabase/SKILL.md'),
    ]);
    expect(result.find((s) => s.scope === 'project')?.shadowedByPath).toBeNull();
    expect(result.find((s) => s.scope === 'user')?.shadowedByPath).toBe('/p/supabase/SKILL.md');
    expect(result.find((s) => s.scope === 'plugin')?.shadowedByPath).toBe('/p/supabase/SKILL.md');
  });

  it('unique names are never shadowed', () => {
    const result = dedupeSkills([skill('a', 'user', '/u/a/SKILL.md'), skill('b', 'plugin', '/pl/b/SKILL.md')]);
    expect(result.every((s) => s.shadowedByPath === null)).toBe(true);
  });
});
