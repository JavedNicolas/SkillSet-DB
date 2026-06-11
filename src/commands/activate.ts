import { loadConfig, saveConfig } from '../config.js';
import { openProjectDb } from '../db/database.js';
import { applyActivation } from '../detect/activation.js';
import { findProjectRoot, projectDbPath } from '../paths.js';

/**
 * Hard per-project overrides: `skillsdb enable <name>` / `disable <name>`.
 * Saved in .skillsdb/config.json; they outrank auto-activation. No LLM call
 * here — cached auto decisions are reused, only the precedence re-resolves.
 */
export async function setSkillOverride(cwd: string, name: string, enable: boolean): Promise<void> {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }

  const config = loadConfig(projectRoot);
  config.enabledSkills = config.enabledSkills.filter((n) => n !== name);
  config.disabledSkills = config.disabledSkills.filter((n) => n !== name);
  (enable ? config.enabledSkills : config.disabledSkills).push(name);
  saveConfig(projectRoot, config);

  const db = openProjectDb(projectDbPath(projectRoot));
  try {
    const known = (db.prepare('SELECT DISTINCT name FROM skills').all() as { name: string }[]).map((s) => s.name);
    if (!known.includes(name)) {
      const closest = known.find((k) => k.includes(name) || name.includes(k));
      console.log(
        `No indexed skill named '${name}'${closest ? ` (closest: ${closest})` : ''}. ` +
          'Override saved; it will apply if such a skill is installed.',
      );
    }
    await applyActivation(db, projectRoot, config, { noLlm: true });
    const row = db
      .prepare('SELECT active, inactive_reason FROM skills WHERE name = ? AND shadowed_by IS NULL')
      .get(name) as { active: number; inactive_reason: string | null } | undefined;
    if (row) {
      console.log(
        row.active ? `${name} is now active.` : `${name} is now inactive (${row.inactive_reason ?? 'disabled'}).`,
      );
    }
  } finally {
    db.close();
  }
}
