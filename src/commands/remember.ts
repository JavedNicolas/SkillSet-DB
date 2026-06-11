import { openProjectDb } from '../db/database.js';
import { findProjectRoot, projectDbPath } from '../paths.js';
import { forgetRule, rememberRule } from '../memory/remember.js';

export interface RememberCmdOptions {
  project?: boolean; // --project => project scope (default: global)
  tech?: string;
  category?: string;
  priority?: string;
  triggers?: string;
  detail?: string;
}

export async function rememberCommand(cwd: string, ruleText: string, options: RememberCmdOptions): Promise<void> {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }
  const db = openProjectDb(projectDbPath(projectRoot));
  try {
    const result = await rememberRule(db, projectRoot, options.project ? 'project' : 'global', {
      ruleText,
      tech: options.tech,
      category: options.category,
      priority: options.priority ? Number(options.priority) : undefined,
      triggers: options.triggers?.split(/[,\s]+/).filter(Boolean),
      detail: options.detail,
    });
    console.log(
      `Remembered (${result.scope}, ${result.tech}): ${ruleText}\n` +
        `  skill: ${result.skillName}\n  file : ${result.referencePath}\n` +
        'The rule is indexed and will be injected when relevant.',
    );
  } finally {
    db.close();
  }
}

export async function forgetCommand(cwd: string, id: string): Promise<void> {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }
  const ruleId = Number(id.replace(/^[rR]/, ''));
  if (!Number.isInteger(ruleId)) {
    console.log(`Invalid rule id '${id}' — pass the R-number shown by skillsdb list --rules.`);
    process.exitCode = 1;
    return;
  }
  const db = openProjectDb(projectDbPath(projectRoot));
  try {
    const removed = await forgetRule(db, ruleId);
    console.log(
      removed
        ? `Forgot rule R${ruleId}.`
        : `R${ruleId} is not a remembered rule (only skillsdb-memory rules can be forgotten — edit the skill file for the rest).`,
    );
    if (!removed) process.exitCode = 1;
  } finally {
    db.close();
  }
}
