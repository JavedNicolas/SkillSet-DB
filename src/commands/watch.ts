import { openProjectDb } from '../db/database.js';
import { loadConfig } from '../config.js';
import { findProjectRoot, projectDbPath } from '../paths.js';
import { makeLlmExtractor } from '../extract/claudeCli.js';
import { makeLlmActivator } from '../detect/activation.js';
import { watchSkills } from '../watch/watcher.js';

export interface WatchOptions {
  llm?: boolean;
}

export async function watchCommand(cwd: string, options: WatchOptions): Promise<void> {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    console.log('No SkillsDB index found. Run `skillsdb init` in your project.');
    process.exitCode = 1;
    return;
  }
  const db = openProjectDb(projectDbPath(projectRoot));
  const config = loadConfig(projectRoot);
  const noLlm = options.llm === false || config.noLlm;
  const llmExtract = noLlm ? undefined : makeLlmExtractor(db, config);

  const close = watchSkills(db, projectRoot, {
    noLlm,
    llmExtract: llmExtract ?? undefined,
    llmActivate: (noLlm ? null : makeLlmActivator(config)) ?? undefined,
    onProgress: (m) => console.log(m),
  });

  const shutdown = async () => {
    await close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // keep the process alive
  await new Promise(() => {});
}
