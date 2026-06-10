import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG, saveConfig, configPath } from '../config.js';
import { openProjectDb } from '../db/database.js';
import { runIndex } from '../indexer.js';
import { projectDbDir, projectDbPath } from '../paths.js';
import { hookCommand, installMcp } from '../install/mcp.js';
import { installHook } from '../install/settings.js';
import { makeLlmExtractor } from '../extract/claudeCli.js';
import { loadConfig } from '../config.js';

export interface InitOptions {
  hook?: boolean; // --no-hook => false
  mcp?: boolean; // --no-mcp => false
  llm?: boolean; // --no-llm => false
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
      onProgress: (m) => console.log(`  ${m}`),
    });
    console.log(
      `\nSkillsDB ready: ${summary.scanned} skills, ${summary.rules} rules.\n` +
        'Rules matching each prompt are now injected automatically. Try: skillsdb match "your task"',
    );
  } finally {
    db.close();
  }
}
