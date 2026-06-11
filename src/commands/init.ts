import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, saveConfig, configPath } from '../config.js';
import { openProjectDb } from '../db/database.js';
import { runIndex } from '../indexer.js';
import { projectDbDir, projectDbPath } from '../paths.js';
import { hookCommand, installMcp } from '../install/mcp.js';
import { installHook } from '../install/settings.js';
import { makeLlmExtractor } from '../extract/claudeCli.js';
import { applyActivation, makeLlmActivator } from '../detect/activation.js';
import { detectStack } from '../detect/stack.js';
import { setMeta } from '../db/queries.js';
import { loadConfig } from '../config.js';

export interface InitOptions {
  hook?: boolean; // --no-hook => false
  mcp?: boolean; // --no-mcp => false
  llm?: boolean; // --no-llm => false
  interactive?: boolean; // --no-interactive => false
}

export async function initCommand(cwd: string, options: InitOptions): Promise<void> {
  const projectRoot = path.resolve(cwd);
  const dbDir = projectDbDir(projectRoot);

  fs.mkdirSync(dbDir, { recursive: true });
  // self-ignoring directory: keeps the index out of the project's git status
  fs.writeFileSync(path.join(dbDir, '.gitignore'), '*\n');
  if (!fs.existsSync(configPath(projectRoot))) {
    saveConfig(projectRoot, { ...DEFAULT_CONFIG, noLlm: options.llm === false });
  }
  console.log(`Created ${dbDir}`);

  if (options.hook !== false) {
    const result = installHook(projectRoot, hookCommand());
    console.log(
      result === 'installed'
        ? 'Hook registered in .claude/settings.json (UserPromptSubmit)'
        : 'Hook already registered — left untouched',
    );
  }

  if (options.mcp !== false) {
    const result = installMcp(projectRoot);
    console.log(
      result === 'installed' ? 'MCP server registered in .mcp.json' : 'MCP server already registered — left untouched',
    );
  }

  const db = openProjectDb(projectDbPath(projectRoot));
  const config = loadConfig(projectRoot);
  const noLlm = options.llm === false || config.noLlm;
  try {
    const llmExtract = noLlm ? undefined : makeLlmExtractor(db, config);
    if (!noLlm && !llmExtract) {
      console.log('claude CLI not found — using heuristic extraction (re-run `skillsdb index` later to upgrade).');
    }
    console.log('Indexing skills...');
    const summary = await runIndex(db, projectRoot, {
      noLlm,
      llmExtract: llmExtract ?? undefined,
      llmActivate: (noLlm ? null : makeLlmActivator(config)) ?? undefined,
      onProgress: (m) => console.log(`  ${m}`),
    });
    await maybeSelectSkills(db, projectRoot, config, options);

    console.log(
      `\nSkillsDB ready: ${summary.scanned} skills, ${summary.rules} rules.\n` +
        'Rules matching each prompt are now injected automatically. Try: skillsdb match "your task"',
    );
  } finally {
    db.close();
  }
}

/**
 * Empty project (no detectable stack): let the user pick which skills should
 * be active. The selection is a soft baseline — once real stack evidence
 * appears, auto-activation takes over on the next sync.
 */
async function maybeSelectSkills(
  db: ReturnType<typeof openProjectDb>,
  projectRoot: string,
  config: ReturnType<typeof loadConfig>,
  options: InitOptions,
): Promise<void> {
  if (options.interactive === false || !process.stdin.isTTY || !process.stdout.isTTY) return;
  const detection = detectStack(projectRoot);
  if (!detection.isEmpty) return;

  const skills = db
    .prepare(
      `SELECT name, description FROM skills WHERE scope != 'project' AND shadowed_by IS NULL ORDER BY name`,
    )
    .all() as { name: string; description: string | null }[];
  if (skills.length === 0) return;

  console.log('');
  let chosen: string[];
  try {
    const { default: checkbox } = await import('@inquirer/checkbox');
    chosen = await checkbox({
      message: 'No tech stack detected yet — choose which skills should be active in this project:',
      choices: skills.map((s) => ({
        name: `${s.name} — ${(s.description ?? '').slice(0, 70)}`,
        value: s.name,
        checked: true,
      })),
      pageSize: 15,
    });
  } catch {
    // Ctrl-C or prompt failure: keep everything active
    console.log('Selection skipped — all skills stay active.');
    return;
  }

  setMeta(db, 'init_selection', JSON.stringify(chosen));
  await applyActivation(db, projectRoot, config, { noLlm: true });
  console.log(
    `${chosen.length}/${skills.length} skills active. This refines automatically once the project gains a tech stack; ` +
      'override anytime with skillsdb enable/disable.',
  );
}
