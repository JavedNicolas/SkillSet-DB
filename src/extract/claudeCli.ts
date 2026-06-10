import type { Db } from '../db/database.js';
import type { SkillsdbConfig } from '../config.js';
import type { ScannedSkill } from '../scan/scanner.js';
import type { ExtractedRule } from './types.js';

export type LlmExtractor = (skill: ScannedSkill) => Promise<ExtractedRule[] | null>;

/**
 * Build the LLM extractor backed by the headless claude CLI.
 * Returns null when the claude CLI is not available.
 *
 * Placeholder until M3: LLM extraction is not wired yet, so callers always
 * fall back to heuristic extraction.
 */
export function makeLlmExtractor(_db: Db, _config: SkillsdbConfig): LlmExtractor | null {
  return null;
}
