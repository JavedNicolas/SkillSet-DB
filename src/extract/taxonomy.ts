export interface SeedCategory {
  slug: string;
  label: string;
  keywords: string[];
}

/** Hard cap on total categories (seed + LLM-proposed). */
export const MAX_CATEGORIES = 24;

export const TAXONOMY_VERSION = 1;

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    slug: 'architecture',
    label: 'Architecture',
    keywords: ['architecture', 'layer', 'module', 'structure', 'feature', 'folder', 'clean', 'dependency', 'injection', 'scaffold', 'organize', 'boundary'],
  },
  {
    slug: 'coding-style',
    label: 'Coding style',
    keywords: ['style', 'naming', 'convention', 'format', 'lint', 'readability', 'comment', 'idiom', 'refactor'],
  },
  {
    slug: 'ui-design',
    label: 'UI & design',
    keywords: ['ui', 'ux', 'widget', 'component', 'screen', 'layout', 'theme', 'design', 'css', 'style', 'responsive', 'accessibility', 'animation', 'page', 'view'],
  },
  {
    slug: 'state-management',
    label: 'State management',
    keywords: ['state', 'bloc', 'cubit', 'redux', 'store', 'provider', 'riverpod', 'signal', 'reactive', 'event', 'reducer'],
  },
  {
    slug: 'database',
    label: 'Database',
    keywords: ['database', 'sql', 'postgres', 'sqlite', 'migration', 'schema', 'query', 'index', 'table', 'supabase', 'orm', 'rls'],
  },
  {
    slug: 'api-integration',
    label: 'API & integration',
    keywords: ['api', 'rest', 'graphql', 'endpoint', 'http', 'request', 'client', 'sdk', 'webhook', 'integration', 'fetch'],
  },
  {
    slug: 'auth-security',
    label: 'Auth & security',
    keywords: ['auth', 'authentication', 'authorization', 'security', 'session', 'token', 'jwt', 'password', 'login', 'permission', 'secret', 'encrypt', 'rls'],
  },
  {
    slug: 'testing',
    label: 'Testing',
    keywords: ['test', 'unit', 'integration', 'e2e', 'mock', 'coverage', 'tdd', 'assert', 'fixture', 'spec'],
  },
  {
    slug: 'performance',
    label: 'Performance',
    keywords: ['performance', 'optimize', 'cache', 'slow', 'fast', 'memory', 'latency', 'profil', 'benchmark', 'lazy'],
  },
  {
    slug: 'error-handling',
    label: 'Error handling',
    keywords: ['error', 'exception', 'failure', 'either', 'result', 'retry', 'fallback', 'crash', 'logging', 'catch'],
  },
  {
    slug: 'git-workflow',
    label: 'Git & workflow',
    keywords: ['git', 'commit', 'branch', 'merge', 'rebase', 'pr', 'pull', 'review', 'workflow', 'release', 'version'],
  },
  {
    slug: 'devops-ci',
    label: 'DevOps & CI',
    keywords: ['ci', 'cd', 'deploy', 'docker', 'pipeline', 'build', 'release', 'infra', 'kubernetes', 'env', 'config'],
  },
  {
    slug: 'docs',
    label: 'Documentation',
    keywords: ['doc', 'documentation', 'readme', 'comment', 'changelog', 'guide', 'explain'],
  },
  {
    slug: 'dependencies',
    label: 'Dependencies',
    keywords: ['dependency', 'package', 'npm', 'pub', 'pubspec', 'install', 'upgrade', 'version', 'library'],
  },
  {
    slug: 'tooling',
    label: 'Tooling',
    keywords: ['cli', 'tool', 'mcp', 'plugin', 'editor', 'ide', 'script', 'automation', 'hook', 'agent'],
  },
  {
    slug: 'general',
    label: 'General',
    keywords: [],
  },
];

export const CATEGORY_SLUGS = SEED_CATEGORIES.map((c) => c.slug);
