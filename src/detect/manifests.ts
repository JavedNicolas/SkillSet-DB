import matter from 'gray-matter';

export interface Evidence {
  languages: string[];
  frameworks: string[];
  dependencies: string[];
}

/** Dependency name -> framework tag. Names are matched exactly. */
const FRAMEWORK_MAP: Record<string, string> = {
  // dart / flutter
  flutter: 'flutter',
  flutter_bloc: 'bloc',
  bloc: 'bloc',
  flutter_riverpod: 'riverpod',
  hooks_riverpod: 'riverpod',
  riverpod: 'riverpod',
  provider: 'provider',
  get_it: 'getit',
  go_router: 'gorouter',
  freezed: 'freezed',
  // js / ts
  react: 'react',
  'react-dom': 'react',
  'react-native': 'react-native',
  next: 'nextjs',
  vue: 'vue',
  nuxt: 'nuxt',
  svelte: 'svelte',
  '@sveltejs/kit': 'sveltekit',
  '@angular/core': 'angular',
  express: 'express',
  fastify: 'fastify',
  '@nestjs/core': 'nestjs',
  '@supabase/supabase-js': 'supabase',
  '@supabase/ssr': 'supabase',
  firebase: 'firebase',
  'firebase-admin': 'firebase',
  prisma: 'prisma',
  '@prisma/client': 'prisma',
  drizzle_orm: 'drizzle',
  'drizzle-orm': 'drizzle',
  electron: 'electron',
  tailwindcss: 'tailwind',
  // python
  django: 'django',
  flask: 'flask',
  fastapi: 'fastapi',
  // ruby
  rails: 'rails',
  // php
  'laravel/framework': 'laravel',
  // go / rust
  'gin-gonic/gin': 'gin',
  actix_web: 'actix',
  'actix-web': 'actix',
  tokio: 'tokio',
};

export interface ManifestSpec {
  /** Project-root-relative path, or filename probed in subdirs too. */
  file: string;
  language: string | null;
  parse: (content: string) => Evidence;
}

export const MANIFEST_SPECS: ManifestSpec[] = [
  { file: 'package.json', language: 'javascript', parse: parsePackageJson },
  { file: 'pubspec.yaml', language: 'dart', parse: parsePubspec },
  { file: 'go.mod', language: 'go', parse: parseGoMod },
  { file: 'Cargo.toml', language: 'rust', parse: parseCargoToml },
  { file: 'requirements.txt', language: 'python', parse: parseRequirements },
  { file: 'pyproject.toml', language: 'python', parse: parsePyproject },
  { file: 'composer.json', language: 'php', parse: parseComposerJson },
  { file: 'Gemfile', language: 'ruby', parse: parseGemfile },
  { file: 'supabase/config.toml', language: null, parse: () => evidence([], ['supabase'], []) },
  { file: 'deno.json', language: 'typescript', parse: () => evidence([], ['deno'], []) },
];

export function evidence(languages: string[], frameworks: string[], dependencies: string[]): Evidence {
  return { languages, frameworks, dependencies };
}

function depsToEvidence(language: string | null, deps: string[]): Evidence {
  const frameworks = new Set<string>();
  for (const dep of deps) {
    const fw = FRAMEWORK_MAP[dep];
    if (fw) frameworks.add(fw);
  }
  return evidence(language ? [language] : [], [...frameworks], deps);
}

export function parsePackageJson(content: string): Evidence {
  try {
    const pkg = JSON.parse(content);
    const deps = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
    const languages = ['javascript'];
    if (deps.includes('typescript')) languages.push('typescript');
    const ev = depsToEvidence(null, deps);
    return evidence(languages, ev.frameworks, deps);
  } catch {
    return evidence(['javascript'], [], []);
  }
}

export function parsePubspec(content: string): Evidence {
  let deps: string[] = [];
  try {
    // gray-matter wraps js-yaml: parse the whole file as frontmatter
    const data = matter(`---\n${content}\n---`).data as Record<string, unknown>;
    deps = [
      ...Object.keys((data.dependencies as object) ?? {}),
      ...Object.keys((data.dev_dependencies as object) ?? {}),
    ];
  } catch {
    // broken YAML: two-space-indented keys under the dependency sections
    const sections = content.match(/^(dependencies|dev_dependencies):\n((?:[ \t]+.*\n?)*)/gm) ?? [];
    for (const section of sections) {
      for (const m of section.matchAll(/^ {2}([A-Za-z_][\w-]*):/gm)) {
        if (m[1]) deps.push(m[1]);
      }
    }
  }
  const ev = depsToEvidence('dart', deps);
  // any flutter_* package implies the flutter framework, even without the sdk dep
  if (deps.includes('flutter') || deps.some((d) => d.startsWith('flutter_'))) {
    ev.frameworks = [...new Set(['flutter', ...ev.frameworks])];
  }
  return ev;
}

export function parseGoMod(content: string): Evidence {
  const deps: string[] = [];
  for (const m of content.matchAll(/^\s*([\w./-]+\/[\w./-]+)\s+v[\w.-]+/gm)) {
    const path = m[1];
    if (!path) continue;
    deps.push(path);
    const short = path.split('/').slice(-2).join('/');
    if (FRAMEWORK_MAP[short]) deps.push(short);
  }
  return depsToEvidence('go', deps);
}

export function parseCargoToml(content: string): Evidence {
  return depsToEvidence('rust', tomlSectionKeys(content, ['dependencies', 'dev-dependencies']));
}

export function parsePyproject(content: string): Evidence {
  const keys = tomlSectionKeys(content, ['tool.poetry.dependencies', 'project.dependencies']);
  // PEP 621 lists dependencies as array items: "django>=4.0",
  const arrayDeps = [...content.matchAll(/^\s*"([A-Za-z][\w-]*)[^"]*",?\s*$/gm)].map((m) => m[1] ?? '');
  return depsToEvidence('python', [...keys, ...arrayDeps].filter(Boolean).map((d) => d.toLowerCase()));
}

export function parseRequirements(content: string): Evidence {
  const deps = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
    .map((l) => l.split(/[=<>~![\s]/)[0] ?? '')
    .filter(Boolean)
    .map((d) => d.toLowerCase());
  return depsToEvidence('python', deps);
}

export function parseComposerJson(content: string): Evidence {
  try {
    const pkg = JSON.parse(content);
    const deps = [...Object.keys(pkg.require ?? {}), ...Object.keys(pkg['require-dev'] ?? {})].filter(
      (d) => d !== 'php',
    );
    return depsToEvidence('php', deps);
  } catch {
    return evidence(['php'], [], []);
  }
}

export function parseGemfile(content: string): Evidence {
  const deps = [...content.matchAll(/^\s*gem\s+['"]([\w-]+)['"]/gm)].map((m) => m[1] ?? '').filter(Boolean);
  return depsToEvidence('ruby', deps);
}

export function parseCsproj(content: string): Evidence {
  const deps = [...content.matchAll(/PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1] ?? '').filter(Boolean);
  return depsToEvidence('csharp', deps);
}

/** Key names under [section] headers — enough for dependency names, no TOML dep. */
function tomlSectionKeys(content: string, sections: string[]): string[] {
  const keys: string[] = [];
  let current = '';
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = header[1] ?? '';
      continue;
    }
    if (!sections.includes(current)) continue;
    const kv = line.match(/^([A-Za-z_][\w.-]*)\s*=/);
    if (kv?.[1]) keys.push(kv[1]);
  }
  return keys;
}
