import { openProjectDb } from '../db/database.js';
import { runIndex } from '../indexer.js';
import { findProjectRoot, projectDbPath } from '../paths.js';
import { loadConfig } from '../config.js';
import { makeLlmExtractor } from '../extract/claudeCli.js';
import { makeLlmActivator } from '../detect/activation.js';
import { releaseSyncLock } from '../match/stale.js';

export interface IndexCmdOptions {
  force?: boolean;
  llm?: boolean; // commander --no-llm => llm: false
}

export async function indexCommand(cwd: string, options: IndexCmdOptions): Promise<void> {
  const projectRoot = findProjectRoot(cwd) ?? cwd;
  const dbPath = projectDbPath(projectRoot);
  const db = openProjectDb(dbPath);
  const config = loadConfig(projectRoot);
  const noLlm = options.llm === false || config.noLlm;
  try {
    const llmExtract = noLlm ? undefined : makeLlmExtractor(db, config);
    if (!noLlm && !llmExtract) {
      console.log('claude CLI not found — falling back to heuristic extraction.');
    }
    const summary = await runIndex(db, projectRoot, {
      force: options.force,
      noLlm,
      llmExtract: llmExtract ?? undefined,
      llmActivate: (noLlm ? null : makeLlmActivator(config)) ?? undefined,
      onProgress: (m) => console.log(m),
    });
    console.log(
      `\nDone: ${summary.scanned} skills scanned, ${summary.extracted} extracted, ` +
        `${summary.skipped} unchanged, ${summary.rules} rules total, ` +
        `${summary.active} skills active / ${summary.inactive} inactive` +
        (summary.removed.length ? `, removed: ${summary.removed.join(', ')}` : ''),
    );
  } finally {
    db.close();
    releaseSyncLock(projectRoot);
  }
}
