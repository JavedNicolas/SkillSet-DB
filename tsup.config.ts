import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    hook: 'src/hook.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  sourcemap: false,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  // better-sqlite3 is a native addon and must stay external; the rest of the
  // hook's deps are bundled so the hot path loads a single file.
  external: ['better-sqlite3'],
});
