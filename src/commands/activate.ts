import { loadConfig, saveConfig, type SkillsdbConfig } from '../config.js';
import { openProjectDb, type Db } from '../db/database.js';
import { applyActivation } from '../detect/activation.js';
import { findProjectRoot, projectDbPath } from '../paths.js';

interface SkillStateRow {
  name: string;
  scope: string;
  description: string | null;
  active: number;
  inactive_reason: string | null;
}

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

/**
 * `skillsdb add` — interactive picker over the skills that exist on this
 * machine but are inactive for this project; selected ones become hard
 * enabled overrides.
 */
export async function addCommand(cwd: string): Promise<void> {
  await interactiveActivation(cwd, 'add');
}

/**
 * `skillsdb edit` — toggle list of every skill with its current activation
 * state pre-checked. Only toggles become overrides: skills left in their
 * current state stay governed by auto-activation.
 */
export async function editCommand(cwd: string): Promise<void> {
  await interactiveActivation(cwd, 'edit');
}

async function interactiveActivation(cwd: string, mode: 'add' | 'edit'): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(`skillsdb ${mode} is interactive and needs a terminal. Use skillsdb enable/disable <name> instead.`);
    process.exitCode = 1;
    return;
  }
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }

  const db = openProjectDb(projectDbPath(projectRoot));
  try {
    const all = db
      .prepare(
        `SELECT name, scope, description, active, inactive_reason
         FROM skills WHERE shadowed_by IS NULL ORDER BY active DESC, name`,
      )
      .all() as SkillStateRow[];
    const listed = mode === 'add' ? all.filter((s) => !s.active) : all;
    if (listed.length === 0) {
      console.log(mode === 'add' ? 'All skills are already active.' : 'No skills indexed yet — run skillsdb index.');
      return;
    }

    let chosen: string[];
    try {
      const { default: checkbox } = await import('@inquirer/checkbox');
      chosen = await checkbox({
        message:
          mode === 'add'
            ? 'Select skills to activate for this project:'
            : 'Toggle the skills active for this project:',
        choices: listed.map((s) => ({
          name: `${s.name} [${s.scope}] — ${(s.description ?? '').slice(0, 60)}${
            !s.active && mode === 'add' && s.inactive_reason ? ` (${s.inactive_reason})` : ''
          }`,
          value: s.name,
          checked: mode === 'edit' ? Boolean(s.active) : false,
        })),
        pageSize: 15,
      });
    } catch {
      console.log('Cancelled — no changes.');
      return;
    }

    const config = loadConfig(projectRoot);
    const chosenSet = new Set(chosen);
    let changes = 0;
    for (const skill of listed) {
      const wantActive = chosenSet.has(skill.name);
      const isActive = Boolean(skill.active);
      if (mode === 'add' && !wantActive) continue; // add never disables
      if (wantActive === isActive) continue; // unchanged: keep auto-activation in charge
      setOverride(config, skill.name, wantActive);
      changes++;
    }
    if (changes === 0) {
      console.log('No changes.');
      return;
    }
    saveConfig(projectRoot, config);
    const summary = await applyActivation(db, projectRoot, config, { noLlm: true });
    console.log(`Updated ${changes} skill(s): ${summary.active} active, ${summary.inactive} inactive.`);
    printStates(db);
  } finally {
    db.close();
  }
}

function setOverride(config: SkillsdbConfig, name: string, enable: boolean): void {
  config.enabledSkills = config.enabledSkills.filter((n) => n !== name);
  config.disabledSkills = config.disabledSkills.filter((n) => n !== name);
  (enable ? config.enabledSkills : config.disabledSkills).push(name);
}

function printStates(db: Db): void {
  const rows = db
    .prepare(
      `SELECT name, active, inactive_reason FROM skills WHERE shadowed_by IS NULL ORDER BY active DESC, name`,
    )
    .all() as { name: string; active: number; inactive_reason: string | null }[];
  for (const row of rows) {
    console.log(`  ${row.active ? 'on ' : 'off'}  ${row.name}${row.active ? '' : ` (${row.inactive_reason ?? ''})`}`);
  }
}
