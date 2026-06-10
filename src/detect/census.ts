import fs from 'node:fs';
import path from 'node:path';

const MAX_DEPTH = 4;
const MAX_FILES = 2000;

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'target', 'vendor', 'out', 'coverage',
  'Pods', 'DerivedData', '__pycache__',
]);

const EXT_LANGUAGE: Record<string, string> = {
  '.dart': 'dart',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.java': 'java',
  '.cs': 'csharp',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.sql': 'sql',
};

export interface Census {
  /** extension -> count, recognized extensions only */
  extensions: Record<string, number>;
  languages: string[];
  totalRecognized: number;
}

/** Capped breadth-first extension census. Runs in index/sync only, never the hook. */
export function censusProject(projectRoot: string): Census {
  const extensions: Record<string, number> = {};
  let visited = 0;
  let queue: string[] = [projectRoot];

  for (let depth = 0; depth <= MAX_DEPTH && queue.length > 0 && visited < MAX_FILES; depth++) {
    const next: string[] = [];
    for (const dir of queue) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (visited >= MAX_FILES) break;
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        if (entry.isDirectory()) {
          next.push(path.join(dir, entry.name));
        } else if (entry.isFile()) {
          visited++;
          const ext = path.extname(entry.name).toLowerCase();
          if (EXT_LANGUAGE[ext]) extensions[ext] = (extensions[ext] ?? 0) + 1;
        }
      }
    }
    queue = next;
  }

  const languages = [...new Set(Object.keys(extensions).map((e) => EXT_LANGUAGE[e]!))];
  const totalRecognized = Object.values(extensions).reduce((a, b) => a + b, 0);
  return { extensions, languages, totalRecognized };
}
