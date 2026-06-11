import type { ScannedSkill } from '../scan/scanner.js';
import { bestCategory, heuristicExtract, ruleFromReference } from './heuristic.js';
import type { ExtractedRule, ExtractionResult } from './types.js';

export interface ExtractOptions {
  /** Skip LLM extraction (heuristic only). */
  noLlm?: boolean;
  /**
   * LLM extraction function (wired in by the indexer when the claude CLI is
   * available). Returns null when extraction fails — caller falls back to
   * heuristic.
   */
  llmExtract?: (skill: ScannedSkill) => Promise<ExtractedRule[] | null>;
}

/**
 * Extract rules from a skill:
 * - reference files with their own frontmatter -> deterministic, zero LLM
 * - the main body -> LLM when available, heuristic otherwise
 */
export async function extractRules(
  skill: ScannedSkill,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const fallbackCategory = bestCategory(`${skill.name} ${skill.description}`, 'general');
  const referenceRules: ExtractedRule[] = [];
  const llmReferences: typeof skill.references = [];

  for (const ref of skill.references) {
    const rule = ruleFromReference(ref, fallbackCategory);
    if (rule) referenceRules.push(rule);
    else llmReferences.push(ref);
  }

  // SkillsDB-generated memory skills: references carry the exact metadata the
  // user (or Claude) provided; the SKILL.md body is a human-readable mirror —
  // extracting it too would duplicate every rule.
  if (isGeneratedMemorySkill(skill)) {
    return { rules: referenceRules, method: 'llm' };
  }

  if (!options.noLlm && options.llmExtract) {
    const llmRules = await options.llmExtract(skill);
    if (llmRules) {
      return { rules: [...referenceRules, ...llmRules], method: 'llm' };
    }
  }

  return { rules: [...referenceRules, ...heuristicExtract(skill)], method: 'heuristic' };
}

function isGeneratedMemorySkill(skill: ScannedSkill): boolean {
  const metadata = skill.frontmatter?.metadata;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as Record<string, unknown>).generator === 'skillsdb'
  );
}
