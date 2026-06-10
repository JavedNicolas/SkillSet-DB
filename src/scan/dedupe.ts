import type { ScannedSkill } from './scanner.js';

const SCOPE_PRECEDENCE: Record<string, number> = {
  project: 0,
  user: 1,
  agents: 2,
  plugin: 3,
};

export interface DedupedSkill extends ScannedSkill {
  /** Path of the winning skill's main file when this one is shadowed. */
  shadowedByPath: string | null;
}

/**
 * Same skill name at multiple scopes: project > user > agents > plugin.
 * Losers are kept (indexed) but marked shadowed so matching ignores them.
 */
export function dedupeSkills(skills: ScannedSkill[]): DedupedSkill[] {
  const winners = new Map<string, ScannedSkill>();
  for (const skill of skills) {
    const existing = winners.get(skill.name);
    if (!existing || precedence(skill) < precedence(existing)) {
      winners.set(skill.name, skill);
    }
  }
  return skills.map((skill) => {
    const winner = winners.get(skill.name);
    return {
      ...skill,
      shadowedByPath: winner && winner.path !== skill.path ? winner.path : null,
    };
  });
}

function precedence(skill: ScannedSkill): number {
  return SCOPE_PRECEDENCE[skill.scope] ?? 99;
}
