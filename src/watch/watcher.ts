import chokidar from 'chokidar';
import type { Db } from '../db/database.js';
import { runIndex, type IndexOptions } from '../indexer.js';
import { skillRoots } from '../paths.js';

const DEBOUNCE_MS = 2000;

/**
 * Watch every skill root (project + user + agents + plugins) and run an
 * incremental sync after a quiet window. Content hashing keeps no-op events
 * cheap.
 */
export function watchSkills(db: Db, projectRoot: string, options: IndexOptions = {}): () => Promise<void> {
  const dirs = skillRoots(projectRoot).map((r) => r.dir);
  const progress = options.onProgress ?? (() => {});
  progress(`Watching ${dirs.length} skill roots (debounce ${DEBOUNCE_MS}ms)`);

  let timer: NodeJS.Timeout | null = null;
  let syncing = false;
  let pendingAgain = false;

  async function sync(): Promise<void> {
    if (syncing) {
      pendingAgain = true;
      return;
    }
    syncing = true;
    try {
      const summary = await runIndex(db, projectRoot, options);
      if (summary.extracted > 0 || summary.removed.length > 0) {
        progress(`Synced: ${summary.extracted} skills re-extracted, ${summary.rules} rules total`);
      }
    } catch (err) {
      progress(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      syncing = false;
      if (pendingAgain) {
        pendingAgain = false;
        void sync();
      }
    }
  }

  const watcher = chokidar.watch(dirs, {
    ignoreInitial: true,
    ignored: (p) => p.includes('node_modules') || p.includes('.git'),
  });

  watcher.on('all', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void sync(), DEBOUNCE_MS);
  });

  return () => watcher.close();
}
