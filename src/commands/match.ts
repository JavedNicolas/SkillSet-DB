import { openProjectDb } from '../db/database.js';
import { loadConfig } from '../config.js';
import { findProjectRoot, projectDbPath } from '../paths.js';
import { matchRules } from '../match/matcher.js';
import { formatRulesHuman } from '../match/format.js';

export interface MatchCmdOptions {
  category?: string;
  limit?: string;
}

export function matchCommand(cwd: string, text: string, options: MatchCmdOptions): void {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }
  const db = openProjectDb(projectDbPath(projectRoot), { readonly: true });
  try {
    const config = loadConfig(projectRoot);
    const rules = matchRules(db, text, {
      tokenBudget: config.tokenBudget,
      maxRules: options.limit ? Number(options.limit) : config.maxRules,
      category: options.category,
    });
    console.log(formatRulesHuman(rules));
  } finally {
    db.close();
  }
}
