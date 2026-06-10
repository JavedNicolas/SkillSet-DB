import fs from 'node:fs';
import path from 'node:path';
import { projectDbDir } from './paths.js';

export interface SkillsdbConfig {
  /** Max tokens of rules injected by the hook. */
  tokenBudget: number;
  /** Max number of rules injected by the hook. */
  maxRules: number;
  /** Model used for LLM rule extraction. */
  extractionModel: string;
  /** Disable LLM extraction entirely (heuristic only). */
  noLlm: boolean;
}

export const DEFAULT_CONFIG: SkillsdbConfig = {
  tokenBudget: 800,
  maxRules: 15,
  extractionModel: 'claude-opus-4-8',
  noLlm: false,
};

export function configPath(projectRoot: string): string {
  return path.join(projectDbDir(projectRoot), 'config.json');
}

export function loadConfig(projectRoot: string): SkillsdbConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(projectRoot), 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(projectRoot: string, config: SkillsdbConfig): void {
  fs.mkdirSync(projectDbDir(projectRoot), { recursive: true });
  fs.writeFileSync(configPath(projectRoot), JSON.stringify(config, null, 2) + '\n');
}
